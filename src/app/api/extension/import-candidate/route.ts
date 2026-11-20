import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { auditProfile } from "@/lib/groq";
import { authenticate, getOwnedJob, handle, HttpError, json, preflight } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ImportCandidateBody } from "@/lib/schemas";
import { tierFor } from "@/lib/tier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;

const pos = (n: number) => (Number.isFinite(n) && n >= 0 ? n : null);
const clean = (s: string) => (s && s.trim() ? s.trim() : null);

/** Strip query/hash so the same profile opened from different Resdex views dedupes. */
function normalizeUrl(u?: string) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return u.trim() || null;
  }
}

export function POST(req: NextRequest) {
  return handle(async () => {
    const user = await authenticate(req);
    const body = ImportCandidateBody.parse(await req.json());
    const { job, rubric } = await getOwnedJob(user.id, body.jobId);

    let audit = body.audit;
    if (!audit) {
      if (!body.rawText) throw new HttpError(400, "Provide either `audit` or `rawText`");
      audit = await auditProfile(rubric, body.rawText);
    }
    const x = audit.extracted;
    const url = normalizeUrl(body.profileUrl);
    const email = clean(x.email)?.toLowerCase() ?? null;
    const phone = clean(x.phone)?.replace(/[^\d+]/g, "") ?? null;

    const score = Math.max(0, Math.min(100, Math.round(audit.score)));
    const data = {
      fullName: clean(x.fullName) ?? "Unknown candidate",
      currentRole: clean(x.currentRole),
      currentCompany: clean(x.currentCompany),
      totalExp: pos(x.totalExpYears),
      currentCtc: pos(x.currentCtcLpa),
      expectedCtc: pos(x.expectedCtcLpa),
      noticePeriod: clean(x.noticePeriod),
      location: clean(x.location),
      email,
      phone,
      naukriProfileUrl: url,
      rawProfileText: body.rawText?.slice(0, 20000) ?? null,
      aiScore: score,
      aiTier: tierFor(score),
      matchedSkills: audit.matchedSkills,
      missingSkills: audit.missingSkills,
      aiVerdict: audit.verdict,
      interviewQuestions: audit.interviewQuestions.slice(0, 3),
      auditJson: {
        strengths: audit.strengths,
        risks: audit.risks,
        noticeFit: audit.noticeFit,
        noticeNote: audit.noticeNote,
        ctcFit: audit.ctcFit,
        ctcNote: audit.ctcNote,
        experienceNote: audit.experienceNote,
      } as Prisma.InputJsonValue,
    };

    // Deduplicate within the job by email / phone / profile URL.
    const or: Prisma.CandidateWhereInput[] = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    if (url) or.push({ naukriProfileUrl: url });
    const existing = or.length ? await prisma.candidate.findFirst({ where: { jobId: job.id, OR: or } }) : null;

    if (existing) {
      // Refresh scorecard but never overwrite known contact data with blanks, nor reset the pipeline status.
      const merged = await prisma.candidate.update({
        where: { id: existing.id },
        data: {
          ...data,
          email: data.email ?? existing.email,
          phone: data.phone ?? existing.phone,
          naukriProfileUrl: data.naukriProfileUrl ?? existing.naukriProfileUrl,
        },
      });
      return json({ candidate: { id: merged.id }, duplicate: true, webUrl: `/jobs/${job.id}` });
    }

    const created = await prisma.candidate.create({ data: { ...data, jobId: job.id } });
    return json({ candidate: { id: created.id }, duplicate: false, webUrl: `/jobs/${job.id}` }, 201);
  });
}
