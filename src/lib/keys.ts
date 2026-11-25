import { sha1 } from "./crypto";
import type { Rubric } from "./schemas";

/** Bump when prompts / scoring maths change in a way that should invalidate cached scores. */
export const SCORING_VERSION = "3";

/** Strip query/hash so the same profile opened from different Resdex views dedupes. */
export function normalizeUrl(u?: string | null) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return u.trim() || null;
  }
}

/** lower-case alphanumerics only → insensitive to spacing, bullets, casing and punctuation churn. */
export const canonicalText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Fingerprint of the candidate's CONTENT. If this changes, a cached score is stale. */
export const contentHash = (text: string) => sha1(canonicalText(text)).slice(0, 32);

/**
 * Candidate IDENTITY inside one HR's job:
 *   • profile URL when we have a real one  → "u:<hash>"   (same person, even if the card text changes)
 *   • otherwise the text fingerprint        → "t:<hash>"   (cards without a link, uploaded résumés)
 */
export function candidateKey(text: string, url?: string | null): string {
  const u = url && !url.startsWith("card:") ? normalizeUrl(url) : null;
  return u ? `u:${sha1(u).slice(0, 24)}` : `t:${contentHash(text)}`;
}

const sortedLc = (a: string[] | undefined) => [...(a ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean).sort();

/**
 * Hash of everything that can change a SCORE (not the search helpers: boolean query, variants, keywords).
 * Re-ordering skills or editing the Resdex query keeps the hash; changing a requirement, limit or alias changes it.
 */
export function rubricHash(r: Rubric): string {
  const canon = {
    v: SCORING_VERSION,
    title: r.title.trim().toLowerCase(),
    seniority: r.seniority,
    must: sortedLc(r.mustHaveSkills),
    imp: sortedLc(r.importantSkills),
    nice: sortedLc(r.niceToHaveSkills),
    years: [...r.skillMinYears].map((x) => `${x.skill.trim().toLowerCase()}:${x.years}`).sort(),
    alias: [...r.skillAliases].map((x) => `${x.skill.trim().toLowerCase()}:${sortedLc(x.aliases).join("|")}`).sort(),
    exp: [r.minExperienceYears, r.maxExperienceYears],
    notice: r.maxNoticePeriodDays,
    ctc: [r.ctcBudgetMinLpa, r.ctcBudgetMaxLpa],
    edu: [r.education.trim().toLowerCase(), r.educationRequired],
    cert: sortedLc(r.certifications),
    ind: sortedLc(r.industries),
    ct: sortedLc(r.companyTypes),
    resp: sortedLc(r.responsibilities),
    db: sortedLc(r.dealBreakers),
    loc: sortedLc(r.locations),
    remote: r.remotePolicy,
    ctx: r.domainContext.trim().toLowerCase(),
  };
  return sha1(JSON.stringify(canon)).slice(0, 24);
}
