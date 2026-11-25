import type { Candidate, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { Audit, CardImport } from "./schemas";
import { tierFor } from "./tier";
import { normalizeUrl } from "./keys";

export { normalizeUrl };

/**
 * One place that decides how a candidate is created / deduplicated / merged inside a job.
 * Used by POST /api/extension/import-candidate (card + full profile) and POST /api/jobs/[id]/candidates/upload.
 *
 * A record's data level is implicit, so no DB migration is needed:
 *   auditJson === null  → CARD-level  (saved from a search-result card; no email/phone; no deep audit)
 *   auditJson !== null  → FULL-level  (deep audit exists)
 *
 * Merge rules
 *   • Match inside the job by email → phone → normalised profile URL → (name + company | name + experience) fingerprint.
 *     The fingerprint is deliberately conservative and only used when no hard identifier matched.
 *   • FULL import over an existing CARD record → full data replaces card data, known contact data is never blanked,
 *     pipeline status is kept (a shortlisted card does not get reset).
 *   • CARD import over an existing FULL record → never downgrades; only fills the profile URL if it was missing.
 *   • CARD import over a CARD record → refreshes the card scorecard.
 */

const pos = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
export const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface UpsertResult {
  candidate: Candidate;
  duplicate: boolean;
  /** true when an existing card-level record was upgraded with full-profile data. */
  upgradedFromCard: boolean;
}

type Identity = { email: string | null; phone: string | null; url: string | null; name: string; company: string | null; exp: number | null };

async function findExisting(jobId: string, id: Identity): Promise<Candidate | null> {
  const or: Prisma.CandidateWhereInput[] = [];
  if (id.email) or.push({ email: id.email });
  if (id.phone) or.push({ phone: id.phone });
  if (id.url) or.push({ naukriProfileUrl: id.url });
  if (or.length) {
    const hit = await prisma.candidate.findFirst({ where: { jobId, OR: or }, orderBy: { createdAt: "asc" } });
    if (hit) return hit;
  }
  // Fingerprint fallback (card records have no email/phone; resumes may have none either).
  const name = norm(id.name);
  if (!name || name === "unknown candidate") return null;
  const sameName = await prisma.candidate.findMany({ where: { jobId, fullName: { equals: id.name.trim(), mode: "insensitive" } }, take: 10 });
  return (
    sameName.find((c) => {
      const company = norm(c.currentCompany);
      if (id.company && company) return norm(id.company) === company;
      if (id.exp !== null && c.totalExp !== null) return Math.abs(id.exp - c.totalExp) <= 0.5; // company unknown on one side → same experience
      return false;
    }) ?? null
  );
}

/** Audit-derived columns (FULL level). */
function fullData(audit: Audit & { tier?: string }, rawText: string | null | undefined, url: string | null, fallbackName?: string) {
  const x = audit.extracted;
  const score = Math.max(0, Math.min(100, Math.round(audit.score)));
  return {
    fullName: clean(x.fullName) ?? clean(fallbackName) ?? "Unknown candidate",
    currentRole: clean(x.currentRole),
    currentCompany: clean(x.currentCompany),
    totalExp: pos(x.totalExpYears),
    currentCtc: pos(x.currentCtcLpa),
    expectedCtc: pos(x.expectedCtcLpa),
    noticePeriod: clean(x.noticePeriod),
    location: clean(x.location),
    email: clean(x.email)?.toLowerCase() ?? null,
    phone: clean(x.phone)?.replace(/[^\d+]/g, "") ?? null,
    naukriProfileUrl: url,
    rawProfileText: rawText?.slice(0, 20000) ?? null,
    aiScore: score,
    aiTier: tierFor(score),
    matchedSkills: audit.matchedSkills,
    missingSkills: audit.missingSkills,
    aiVerdict: audit.verdict,
    interviewQuestions: audit.interviewQuestions.slice(0, 3),
    auditJson: {
      strengths: audit.strengths,
      risks: audit.risks,
      gaps: audit.gaps ?? [],
      breakdown: audit.breakdown ?? null,
      noticeFit: audit.noticeFit,
      noticeNote: audit.noticeNote,
      ctcFit: audit.ctcFit,
      ctcNote: audit.ctcNote,
      experienceNote: audit.experienceNote,
      checks: audit.checks,
      flags: audit.flags,
    } as Prisma.InputJsonValue,
  };
}

/** Full-profile import: Resdex profile (extension) or an uploaded resume (dashboard). */
export async function upsertFullCandidate(args: {
  /** Owner — used to verify the résumé being linked belongs to the same HR. */
  userId: string;
  jobId: string;
  audit: Audit & { tier?: string };
  rawText?: string | null;
  profileUrl?: string | null;
  fallbackName?: string;
  /** Rubric hash the score was computed with (lets the UI flag scores made under an older rubric). */
  rubricHash?: string;
  /** A stored Resume row (lib/resumes.ts) to link to this candidate. */
  resumeId?: string;
}): Promise<UpsertResult> {
  const url = normalizeUrl(args.profileUrl);
  const data = { ...fullData(args.audit, args.rawText, url, args.fallbackName), scoredRubricHash: args.rubricHash ?? null };
  const linkResume = async (candidateId: string) => {
    if (!args.resumeId) return;
    await prisma.resume.updateMany({ where: { id: args.resumeId, userId: args.userId }, data: { candidateId, jobId: args.jobId } });
  };
  const existing = await findExisting(args.jobId, { email: data.email, phone: data.phone, url, name: data.fullName, company: data.currentCompany, exp: data.totalExp });

  if (!existing) {
    const created = await prisma.candidate.create({ data: { ...data, jobId: args.jobId } });
    await linkResume(created.id);
    return { candidate: created, duplicate: false, upgradedFromCard: false };
  }
  const wasCard = existing.auditJson === null;
  const merged = await prisma.candidate.update({
    where: { id: existing.id },
    data: {
      ...data,
      // never overwrite known data with blanks (a full audit may not see everything the card did, and vice-versa)
      fullName: data.fullName === "Unknown candidate" ? existing.fullName : data.fullName,
      currentRole: data.currentRole ?? existing.currentRole,
      currentCompany: data.currentCompany ?? existing.currentCompany,
      totalExp: data.totalExp ?? existing.totalExp,
      currentCtc: data.currentCtc ?? existing.currentCtc,
      expectedCtc: data.expectedCtc ?? existing.expectedCtc,
      noticePeriod: data.noticePeriod ?? existing.noticePeriod,
      location: data.location ?? existing.location,
      email: data.email ?? existing.email,
      phone: data.phone ?? existing.phone,
      naukriProfileUrl: data.naukriProfileUrl ?? existing.naukriProfileUrl,
      // status intentionally untouched → pipeline stage survives re-imports / card→full upgrades
    },
  });
  await linkResume(merged.id);
  return { candidate: merged, duplicate: true, upgradedFromCard: wasCard };
}

/** Card-level import: no LLM call, no email/phone, status SHORTLISTED (column default). */
export async function upsertCardCandidate(args: { jobId: string; card: CardImport; rubricHash?: string }): Promise<UpsertResult & { skippedBecauseFull: boolean }> {
  const c = args.card;
  const url = normalizeUrl(c.naukriProfileUrl);
  const score = Math.max(0, Math.min(100, Math.round(c.aiScore)));
  const data = {
    fullName: clean(c.fullName) ?? "Unknown candidate",
    currentRole: clean(c.currentRole),
    currentCompany: clean(c.currentCompany),
    totalExp: pos(c.totalExp),
    currentCtc: pos(c.currentCtc),
    expectedCtc: pos(c.expectedCtc),
    noticePeriod: clean(c.noticePeriod),
    location: clean(c.location),
    naukriProfileUrl: url,
    rawProfileText: c.rawProfileText.slice(0, 2500),
    aiScore: score,
    aiTier: tierFor(score),
    matchedSkills: c.matchedSkills,
    missingSkills: c.missingSkills,
    aiVerdict: clean(c.verdict) ?? "Card-level screening only — profile not opened yet.",
    scoredRubricHash: args.rubricHash ?? null,
  };
  const existing = await findExisting(args.jobId, { email: null, phone: null, url, name: data.fullName, company: data.currentCompany, exp: data.totalExp });

  if (!existing) {
    const created = await prisma.candidate.create({ data: { ...data, interviewQuestions: [], jobId: args.jobId } });
    return { candidate: created, duplicate: false, upgradedFromCard: false, skippedBecauseFull: false };
  }
  if (existing.auditJson !== null) {
    // Already has a deep audit → keep it. Only learn the profile URL if we didn't have one.
    const kept = existing.naukriProfileUrl || !url ? existing : await prisma.candidate.update({ where: { id: existing.id }, data: { naukriProfileUrl: url } });
    return { candidate: kept, duplicate: true, upgradedFromCard: false, skippedBecauseFull: true };
  }
  const refreshed = await prisma.candidate.update({
    where: { id: existing.id },
    data: {
      ...data,
      fullName: data.fullName === "Unknown candidate" ? existing.fullName : data.fullName,
      naukriProfileUrl: url ?? existing.naukriProfileUrl,
    },
  });
  return { candidate: refreshed, duplicate: true, upgradedFromCard: false, skippedBecauseFull: false };
}
