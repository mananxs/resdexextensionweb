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

export const RubricZ = z.object({
  title: z.string(),
  department: z.string().default(""),
  seniority: z.enum(SENIORITY),
  mustHaveSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  minExperienceYears: z.number(), // -1 = not stated
  maxExperienceYears: z.number(), // -1 = not stated
  maxNoticePeriodDays: z.number(), // -1 = not stated
  ctcBudgetMinLpa: z.number(), // -1 = not stated
  ctcBudgetMaxLpa: z.number(), // -1 = not stated
  locations: z.array(z.string()),
  remotePolicy: z.enum(REMOTE),
  domainContext: z.string(),
  coreKeywords: z.array(z.string()),
});
export type Rubric = z.infer<typeof RubricZ>;

export const RubricJSON = obj({
  title: str,
  department: str,
  seniority: en([...SENIORITY]),
  mustHaveSkills: arr(str),
  niceToHaveSkills: arr(str),
  minExperienceYears: num,
  maxExperienceYears: num,
  maxNoticePeriodDays: int,
  ctcBudgetMinLpa: num,
  ctcBudgetMaxLpa: num,
  locations: arr(str),
  remotePolicy: en([...REMOTE]),
  domainContext: str,
  coreKeywords: arr(str),
});

/* ─────────────── Batch card scoring ─────────────── */

export const CardResultZ = z.object({
  domId: z.string(),
  score: z.number(),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  noticePeriod: z.string(),
  noticeDays: z.number(), // -1 unknown
  ctc: z.string(),
  oneLineVerdict: z.string(),
});
export const BatchOutZ = z.object({ results: z.array(CardResultZ) });
export type BatchOut = z.infer<typeof BatchOutZ>;

export const BatchJSON = obj({
  results: arr(
    obj({
      domId: str,
      score: int,
      matchedSkills: arr(str),
      missingSkills: arr(str),
      noticePeriod: str,
      noticeDays: int,
      ctc: str,
      oneLineVerdict: str,
    }),
  ),
});

/* ─────────────── Deep profile audit ─────────────── */

const FIT = ["good", "ok", "risk", "unknown"] as const;

export const AuditZ = z.object({
  extracted: z.object({
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
  }),
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
});
export type Audit = z.infer<typeof AuditZ>;

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
  score: int,
  matchedSkills: arr(str),
  missingSkills: arr(str),
  strengths: arr(str),
  risks: arr(str),
  noticeFit: en([...FIT]),
  noticeNote: str,
  ctcFit: en([...FIT]),
  ctcNote: str,
  experienceNote: str,
  interviewQuestions: arr(str),
  verdict: str,
});

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
    .array(z.object({ domId: z.string().min(1).max(64), rawText: z.string().max(10000) }))
    .min(1)
    .max(20),
});

export const ScoreProfileBody = z.object({
  jobId: z.string().min(1),
  rawText: z.string().min(30).max(20000),
  profileUrl: z.string().max(2000).optional(),
});

export const ImportCandidateBody = z.object({
  jobId: z.string().min(1),
  profileUrl: z.string().max(2000).optional(),
  rawText: z.string().max(20000).optional(),
  /** The audit previously returned by /score-profile. If omitted the server audits rawText itself. */
  audit: AuditZ.optional(),
});
