import { z } from "zod";

/**
 * Each LLM output has TWO definitions kept side by side:
 *  - a strict JSON Schema (sent to Groq `response_format`, strict: true → every key required,
 *    additionalProperties: false, no nullable fields → we use "" / -1 sentinels)
 *  - a Zod schema (validates what came back, and types the code)
 */

type J = Record<string, unknown>;
const str: J = { type: "string" };
const num: J = { type: "number" };
const int: J = { type: "integer" };
const bool: J = { type: "boolean" };
const arr = (items: J): J => ({ type: "array", items });
const en = (values: string[]): J => ({ type: "string", enum: values });
const obj = (props: Record<string, J>): J => ({
  type: "object",
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});

/* ─────────────── JD rubric ─────────────── */

export const SENIORITY = ["intern", "junior", "mid", "senior", "lead", "manager", "director", "unspecified"] as const;
export const REMOTE = ["onsite", "hybrid", "remote", "flexible", "unspecified"] as const;

const strArr = () => z.array(z.string()).default([]);

export const RubricZ = z.object({
  title: z.string(),
  department: z.string().default(""),
  seniority: z.enum(SENIORITY),

  // Skills by priority. must = hard requirement, important = strongly preferred / core to the responsibilities, nice = bonus.
  mustHaveSkills: z.array(z.string()),
  importantSkills: strArr(),
  niceToHaveSkills: z.array(z.string()),
  /** "3+ years of React" → { skill: "React", years: 3 } */
  skillMinYears: z.array(z.object({ skill: z.string(), years: z.number() })).default([]),
  /** Equivalent / implied terms accepted as evidence for a skill (Next.js ⇒ React). */
  skillAliases: z.array(z.object({ skill: z.string(), aliases: z.array(z.string()) })).default([]),

  minExperienceYears: z.number(), // -1 = not stated
  maxExperienceYears: z.number(), // -1 = not stated
  maxNoticePeriodDays: z.number(), // -1 = not stated
  ctcBudgetMinLpa: z.number(), // -1 = not stated
  ctcBudgetMaxLpa: z.number(), // -1 = not stated

  education: z.string().default(""), // "B.Tech/BE in CS or equivalent" or ""
  educationRequired: z.boolean().default(false),
  certifications: strArr(),
  industries: strArr(), // domains/industries the candidate should have worked in
  companyTypes: strArr(), // "product company", "startup", "MNC", "SaaS" …
  responsibilities: strArr(), // key things the person must have actually done
  dealBreakers: strArr(), // explicit exclusions in the JD ("no freshers", "not from service companies")

  locations: z.array(z.string()),
  remotePolicy: z.enum(REMOTE),
  domainContext: z.string(),

  targetTitles: strArr(), // alternate designations to look for
  searchVariants: z.array(z.object({ label: z.string(), keywords: z.string() })).default([]),
  coreKeywords: z.array(z.string()),

  /* ── Resdex search parameters (added later: every field has a default so rubrics already stored in
   *    Job.parsedRubricJson keep parsing — old rows simply get ""/[]/-1 and the UI falls back to the legacy fields). ── */
  /** Resdex-compatible Boolean string: (core AND ...) with OR-ed aliases and NOT-ed false positives. ≤ MAX_BOOLEAN_CHARS. */
  booleanQuery: z.string().default(""),
  /** The 3–5 non-negotiable skills the Boolean query is built around. */
  mustHaveKeywords: strArr(),
  /** Negative keywords that remove false positives (also used as the NOT clause). */
  excludeKeywords: strArr(),
  /** Experience range for the Resdex min/max fields. -1 = not stated. Mirrors min/maxExperienceYears (see resdexSearchParams). */
  minExp: z.number().default(-1),
  maxExp: z.number().default(-1),
});
export type Rubric = z.infer<typeof RubricZ>;

export const RubricJSON = obj({
  title: str,
  department: str,
  seniority: en([...SENIORITY]),
  mustHaveSkills: arr(str),
  importantSkills: arr(str),
  niceToHaveSkills: arr(str),
  skillMinYears: arr(obj({ skill: str, years: num })),
  skillAliases: arr(obj({ skill: str, aliases: arr(str) })),
  minExperienceYears: num,
  maxExperienceYears: num,
  maxNoticePeriodDays: int,
  ctcBudgetMinLpa: num,
  ctcBudgetMaxLpa: num,
  education: str,
  educationRequired: bool,
  certifications: arr(str),
  industries: arr(str),
  companyTypes: arr(str),
  responsibilities: arr(str),
  dealBreakers: arr(str),
  locations: arr(str),
  remotePolicy: en([...REMOTE]),
  domainContext: str,
  targetTitles: arr(str),
  searchVariants: arr(obj({ label: str, keywords: str })),
  coreKeywords: arr(str),
  booleanQuery: str,
  mustHaveKeywords: arr(str),
  excludeKeywords: arr(str),
  minExp: num,
  maxExp: num,
});

/* ─────────────── Batch card scoring ───────────────
 * The model only reports FACTS (extracted numbers) and a per-criterion evidence LEVEL.
 * The score itself is computed deterministically on the server (lib/scoring.ts). */

export const CardFactsZ = z.object({
  domId: z.string(),
  levels: z.array(z.number()), // one per criterion, in order: 0 none · 1 partial · 2 clear (dealbreaker: 2 = present)
  expYears: z.number(),
  noticePeriod: z.string(),
  noticeDays: z.number(),
  currentCtcLpa: z.number(),
  expectedCtcLpa: z.number(),
  location: z.string(),
  // Card-level identity/metadata (used for "Save Card to Shortlist" without opening the profile)
  fullName: z.string(),
  currentRole: z.string(),
  currentCompany: z.string(),
  headline: z.string(),
  skills: z.array(z.string()),
  oneLineVerdict: z.string(),
});
export const BatchOutZ = z.object({ results: z.array(CardFactsZ) });

export const BatchJSON = obj({
  results: arr(
    obj({
      domId: str,
      levels: arr(int),
      expYears: num,
      noticePeriod: str,
      noticeDays: int,
      currentCtcLpa: num,
      expectedCtcLpa: num,
      location: str,
      fullName: str,
      currentRole: str,
      currentCompany: str,
      headline: str,
      skills: arr(str),
      oneLineVerdict: str,
    }),
  ),
});

/* ─────────────── Deep profile audit ─────────────── */

const FIT = ["good", "ok", "risk", "unknown"] as const;

const ExtractedZ = z.object({
  fullName: z.string(),
  currentRole: z.string(),
  currentCompany: z.string(),
  totalExpYears: z.number(), // -1 unknown
  currentCtcLpa: z.number(), // -1 unknown
  expectedCtcLpa: z.number(), // -1 unknown
  noticePeriod: z.string(),
  noticeDays: z.number(),
  location: z.string(),
  email: z.string(),
  phone: z.string(),
});

/** What the model returns. */
export const AuditLLMZ = z.object({
  extracted: ExtractedZ,
  checks: z.array(z.object({ id: z.number(), level: z.number(), evidence: z.string() })),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  /** Concrete gaps vs. the rubric (missing must-haves, short experience, unverified claims). */
  gaps: z.array(z.string()).default([]),
  noticeNote: z.string(),
  ctcNote: z.string(),
  experienceNote: z.string(),
  interviewQuestions: z.array(z.string()),
  verdict: z.string(),
});

export const AuditJSON = obj({
  extracted: obj({
    fullName: str,
    currentRole: str,
    currentCompany: str,
    totalExpYears: num,
    currentCtcLpa: num,
    expectedCtcLpa: num,
    noticePeriod: str,
    noticeDays: int,
    location: str,
    email: str,
    phone: str,
  }),
  checks: arr(obj({ id: int, level: int, evidence: str })),
  strengths: arr(str),
  risks: arr(str),
  gaps: arr(str),
  noticeNote: str,
  ctcNote: str,
  experienceNote: str,
  interviewQuestions: arr(str),
  verdict: str,
});

export const CheckZ = z.object({
  label: z.string(),
  tier: z.string(), // must | important | nice | other | fit
  level: z.number(), // 0 | 1 | 2
  evidence: z.string(),
});

/** Final audit = LLM facts + server-computed score/fits. This is what the extension stores and imports. */
export const AuditZ = z.object({
  extracted: ExtractedZ,
  score: z.number(),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  noticeFit: z.enum(FIT),
  noticeNote: z.string(),
  ctcFit: z.enum(FIT),
  ctcNote: z.string(),
  experienceNote: z.string(),
  interviewQuestions: z.array(z.string()),
  verdict: z.string(),
  checks: z.array(CheckZ).default([]),
  flags: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  /** Server-computed "why this score" (components, coverage, caps, confidence). Passed through untouched. */
  breakdown: z
    .object({
      rawScore: z.number(),
      gates: z.array(z.string()),
      coverage: z.object({ must: z.number().nullable(), important: z.number().nullable(), nice: z.number().nullable() }),
      components: z.array(z.object({ label: z.string(), tier: z.string(), weight: z.number(), credit: z.number(), known: z.boolean() })),
      confidence: z.enum(["high", "medium", "low"]),
    })
    .optional(),
});
export type Audit = z.infer<typeof AuditZ>;

/* ─────────────── Request bodies ─────────────── */

export const CreateJobBody = z.object({
  title: z.string().trim().max(200).optional(),
  department: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  rawDescription: z.string().trim().min(40, "Job description is too short").max(30000),
  rubric: RubricZ.optional(), // pass when the UI already analysed the JD → avoids a second Groq call
});

export const ScoreBatchBody = z.object({
  jobId: z.string().min(1),
  candidates: z
    .array(z.object({ domId: z.string().min(1).max(64), rawText: z.string().max(10000), profileUrl: z.string().max(2000).optional() }))
    .min(1)
    .max(40),
  /** The Naukri search these cards were found in (POST /search-session). Analyzed cards are linked to it. */
  searchSessionId: z.string().max(64).optional(),
  /** true → "Analyzed only": return cached scores, make NO LLM call; uncached cards come back in `unscored`. */
  onlyCached: z.boolean().optional(),
  /** true → ignore the cache and re-score (explicit "Re-score" action). */
  force: z.boolean().optional(),
});

export const ScoreProfileBody = z.object({
  jobId: z.string().min(1),
  rawText: z.string().min(30).max(20000),
  profileUrl: z.string().max(2000).optional(),
  force: z.boolean().optional(),
});

/** One Naukri search: everything the recruiter can set on the Resdex page. */
export const SearchStateZ = z.object({
  keywords: z.string().max(2000).default(""),
  anyKeywords: z.array(z.string().max(200)).max(40).default([]),
  excludeKeywords: z.array(z.string().max(200)).max(40).default([]),
  location: z.string().max(500).default(""),
  minExp: z.number().nullable().default(null),
  maxExp: z.number().nullable().default(null),
  minSalary: z.number().nullable().default(null),
  maxSalary: z.number().nullable().default(null),
  /** Everything else from the filter panels, e.g. { label: "Notice period", value: "15 days or less" }. */
  filters: z.array(z.object({ label: z.string().max(120), value: z.string().max(300) })).max(80).default([]),
  url: z.string().max(2000).default(""),
  page: z.number().int().nullable().default(null),
});
export type SearchState = z.infer<typeof SearchStateZ>;

export const SearchSessionBody = z.object({
  jobId: z.string().min(1).optional(),
  signature: z.string().min(1).max(64),
  state: SearchStateZ,
});

/** Facts + score read off a Resdex SEARCH-RESULT CARD (no profile opened → no CV-view quota spent, no email/phone). */
export const CardImportZ = z.object({
  fullName: z.string().max(200).default(""),
  currentRole: z.string().max(300).default(""),
  currentCompany: z.string().max(300).default(""),
  totalExp: z.number().nullable().optional(), // years; null/-1 = unknown
  currentCtc: z.number().nullable().optional(), // LPA
  expectedCtc: z.number().nullable().optional(), // LPA
  noticePeriod: z.string().max(100).default(""),
  location: z.string().max(200).default(""),
  naukriProfileUrl: z.string().max(2000).optional(),
  rawProfileText: z.string().max(2500), // visible card text only (guardrail: ≤ 2,500 chars)
  aiScore: z.number().min(0).max(100),
  matchedSkills: z.array(z.string().max(100)).max(50).default([]),
  missingSkills: z.array(z.string().max(100)).max(50).default([]),
  verdict: z.string().max(500).default(""),
});
export type CardImport = z.infer<typeof CardImportZ>;

export const ImportCandidateBody = z.object({
  jobId: z.string().min(1),
  profileUrl: z.string().max(2000).optional(),
  rawText: z.string().max(20000).optional(),
  /** The audit previously returned by /score-profile. If omitted the server audits rawText itself. */
  audit: AuditZ.optional(),
  /** Card-level save: stored as SHORTLISTED with no LLM call; later merged when the full profile is imported. */
  card: CardImportZ.optional(),
});
