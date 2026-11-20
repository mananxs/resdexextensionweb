import Groq from "groq-sdk";
import type { ZodType } from "zod";
import {
  AuditJSON,
  AuditZ,
  BatchJSON,
  BatchOutZ,
  RubricJSON,
  RubricZ,
  type Audit,
  type Rubric,
} from "./schemas";
import { tierFor } from "./tier";

export const MODELS = {
  rubric: "openai/gpt-oss-120b", // deep requirement extraction
  batch: "openai/gpt-oss-20b", // ~1000 tok/s real-time scoring
  deep: "openai/gpt-oss-120b", // single-profile audit
} as const;

let _client: Groq | null = null;
function client(): Groq {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set on the server");
  return (_client ??= new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 2 }));
}

/* ─────────────── Shared Indian-recruitment prompt rules ─────────────── */

const INDIA_RULES = `
You are a senior Indian technical recruiter's assistant. Apply Indian hiring conventions:

SKILL MATCHING (semantic, not keyword):
- Treat skill equivalence/implication as a match: Next.js/Gatsby/Remix ⇒ React; React Native ⇒ React; TypeScript ⇒ JavaScript;
  Spring Boot ⇒ Java + Spring; Django/Flask/FastAPI ⇒ Python; Express/NestJS ⇒ Node.js; EKS/AKS/GKE ⇒ Kubernetes;
  PySpark ⇒ Spark + Python; Redshift/BigQuery/Snowflake ⇒ cloud data warehouse; MERN ⇒ MongoDB+Express+React+Node.
- Accept common abbreviations/spellings (JS, TS, K8s, GCP, AWS, ReactJS = React, Node = Node.js, Postgres = PostgreSQL).
- Only credit a skill if the candidate text provides evidence for it. Never invent skills. Do not penalise for absent nice-to-haves heavily.

NOTICE PERIOD (India): "Immediate"/"Serving notice"/"Available now" = 0 days; "15 Days"; "1 Month"=30; "2 Months"=60; "3 Months"=90.
Lower is better. If the JD sets a max notice period, anything above it is a risk; 60–90 days is common and often negotiable/buy-out-able for strong candidates.
If absent in the text, report "Not mentioned" with noticeDays = -1.

COMPENSATION: Figures are in LPA (lakhs per annum, INR). "12.5 Lacs" = 12.5 LPA; "1 Cr" = 100 LPA; monthly figures ×12.
Compare current/expected CTC against the JD budget; expected CTC above budget by >15% is a risk. If CTC is hidden, report "Not disclosed" and do not guess.

EXPERIENCE: Compare total experience to the JD min/max range. Slightly outside the range is a soft penalty; far outside is a heavy one.
Weigh relevant experience over total years, and recency of the relevant stack.
LOCATION: Match candidate location/relocation willingness against JD location & remote policy (e.g. Bengaluru vs Bangalore are the same).

SCORING (integer 0–100): ~50% must-have skills coverage (with equivalence), ~20% experience fit, ~10% nice-to-haves & domain, ~20% notice period + CTC + location fit.
Calibrate: 85+ = strong across all must-haves; 60–79 = solid with a gap or soft mismatch; <45 = weak or missing core must-haves.
Resdex text may be abbreviated, truncated or have masked contact info — judge only what is present and never fabricate.
Output must follow the supplied JSON schema exactly. Use -1 for unknown numbers and "" (or "Not mentioned") for unknown strings.
`.trim();

/* ─────────────── Structured-output call ─────────────── */

interface StructuredArgs<T> {
  model: string;
  name: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  zod: ZodType<T>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

async function structured<T>(a: StructuredArgs<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client().chat.completions.create({
        model: a.model,
        temperature: 0.1,
        max_completion_tokens: a.maxTokens,
        reasoning_effort: a.effort,
        messages: [
          { role: "system", content: a.system },
          { role: "user", content: a.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: a.name, strict: true, schema: a.jsonSchema },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (res as any).choices?.[0]?.message?.content as string | undefined;
      if (!content) throw new Error("Empty response from Groq");
      return a.zod.parse(JSON.parse(content));
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (status && status !== 429 && status < 500) break; // non-retryable (auth, bad request)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Groq call failed");
}

/* ─────────────── 1. JD rubric extraction (120B) ─────────────── */

export async function extractRubric(rawJd: string): Promise<Rubric> {
  const r = await structured({
    model: MODELS.rubric,
    name: "jd_rubric",
    jsonSchema: RubricJSON,
    zod: RubricZ,
    maxTokens: 3000,
    effort: "medium",
    system: `${INDIA_RULES}

TASK: Convert the job description into a structured evaluation rubric.
- title: the role title; department: team/function (e.g. "Engineering", "Data") or "" if unclear.
- mustHaveSkills: hard requirements (max 12, canonical short names, e.g. "React", "Node.js", "PostgreSQL"). Collapse implied skills into the broader one when sensible.
- niceToHaveSkills: preferred / bonus items (max 10).
- min/maxExperienceYears: from phrases like "5-8 years", "5+ years" (max = -1 if open-ended). -1 if absent.
- maxNoticePeriodDays: e.g. "immediate joiners" = 0, "up to 30 days" = 30; -1 if not stated.
- ctcBudgetMin/MaxLpa: convert to LPA; -1 if not stated.
- locations: cities (normalised, e.g. "Bengaluru"); remotePolicy: onsite|hybrid|remote|flexible|unspecified.
- domainContext: one or two sentences on the business/domain (e.g. "B2B fintech payments platform, high-scale transaction systems").
- coreKeywords: 3–5 SHORT plain keywords/titles a recruiter would type in Naukri Resdex's keyword box (NO boolean operators, no quotes, no AND/OR).`,
    user: `JOB DESCRIPTION:\n"""\n${rawJd.slice(0, 20000)}\n"""`,
  });
  return {
    ...r,
    department: r.department ?? "",
    mustHaveSkills: dedupe(r.mustHaveSkills).slice(0, 12),
    niceToHaveSkills: dedupe(r.niceToHaveSkills).slice(0, 10),
    coreKeywords: dedupe(r.coreKeywords.map((k) => k.replace(/\b(AND|OR|NOT)\b|[()"]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean)).slice(0, 5),
  };
}

/* ─────────────── 2. Batch card scoring (20B) ─────────────── */

export interface ScoredCard {
  domId: string;
  score: number;
  tier: string;
  matchedSkills: string[];
  missingSkills: string[];
  noticePeriod: string;
  noticeDays: number;
  ctc: string;
  oneLineVerdict: string;
}

export async function scoreBatch(
  rubric: Rubric,
  cards: { domId: string; rawText: string }[],
): Promise<{ results: ScoredCard[]; missing: string[] }> {
  const body = cards
    .map((c) => `<<<CARD domId="${c.domId}">>>\n${c.rawText.slice(0, 2500)}\n<<<END CARD>>>`)
    .join("\n\n");

  const out = await structured({
    model: MODELS.batch,
    name: "batch_candidate_scores",
    jsonSchema: BatchJSON,
    zod: BatchOutZ,
    maxTokens: Math.min(8000, 400 * cards.length + 500),
    effort: "low",
    system: `${INDIA_RULES}

TASK: Score EVERY candidate card against the rubric. Return exactly one result per card, echoing its domId verbatim.
- matchedSkills / missingSkills: use the rubric's must-have (and notable nice-to-have) skill names; max 6 each; missingSkills = must-haves with no evidence.
- noticePeriod: human readable ("Immediate", "30 days", "Not mentioned"); noticeDays integer or -1.
- ctc: "Current 18 LPA / Expected 24 LPA" style, or "Not disclosed".
- oneLineVerdict: ≤ 18 words, specific (mention the strongest match and the biggest gap).`,
    user: `RUBRIC (JSON):\n${JSON.stringify(rubric)}\n\nCANDIDATE CARDS:\n${body}`,
  });

  const wanted = new Set(cards.map((c) => c.domId));
  const seen = new Set<string>();
  const results: ScoredCard[] = [];
  for (const r of out.results) {
    if (!wanted.has(r.domId) || seen.has(r.domId)) continue;
    seen.add(r.domId);
    const score = clampScore(r.score);
    results.push({
      ...r,
      score,
      tier: tierFor(score),
      matchedSkills: r.matchedSkills.slice(0, 6),
      missingSkills: r.missingSkills.slice(0, 6),
    });
  }
  return { results, missing: cards.map((c) => c.domId).filter((id) => !seen.has(id)) };
}

/* ─────────────── 3. Deep single-profile audit (120B) ─────────────── */

export async function auditProfile(rubric: Rubric, rawText: string): Promise<Audit & { tier: string }> {
  const a = await structured({
    model: MODELS.deep,
    name: "profile_audit",
    jsonSchema: AuditJSON,
    zod: AuditZ,
    maxTokens: 4000,
    effort: "medium",
    system: `${INDIA_RULES}

TASK: Perform a deep audit of ONE candidate profile against the rubric.
- extracted: pull identity/contact facts verbatim from the text (fullName, currentRole, currentCompany, location, email, phone). Resdex often masks contact data — use "" when not visible.
  totalExpYears / currentCtcLpa / expectedCtcLpa as numbers (-1 if unknown); noticePeriod string + noticeDays.
- matchedSkills / missingSkills: against must-haves AND nice-to-haves (prefix nothing; just skill names). Apply semantic equivalence.
- strengths: 3–5 concrete, evidence-based bullets. risks: 2–4 bullets (job-hopping, gaps, seniority mismatch, stack staleness, etc.).
- noticeFit / noticeNote: good|ok|risk|unknown against the JD's max notice period, with a one-sentence note (mention buy-out/negotiability when 60–90 days).
- ctcFit / ctcNote: good|ok|risk|unknown against the budget (LPA), with a one-sentence note.
- experienceNote: one sentence on experience vs. required range and relevance.
- interviewQuestions: EXACTLY 3 tailored, technical/behavioural questions that probe the candidate's biggest gaps and verify their strongest claims.
- verdict: 2 sentences — hire/screen recommendation with reasoning.`,
    user: `RUBRIC (JSON):\n${JSON.stringify(rubric)}\n\nCANDIDATE PROFILE TEXT:\n"""\n${rawText.slice(0, 9000)}\n"""`,
  });
  const score = clampScore(a.score);
  const regexContact = scrapeContact(rawText);
  return {
    ...a,
    score,
    tier: tierFor(score),
    interviewQuestions: a.interviewQuestions.slice(0, 3),
    extracted: {
      ...a.extracted,
      email: a.extracted.email || regexContact.email,
      phone: a.extracted.phone || regexContact.phone,
    },
  };
}

/* ─────────────── helpers ─────────────── */

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
}
function dedupe(a: string[]) {
  const seen = new Set<string>();
  return a.map((s) => s.trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}
export function scrapeContact(text: string) {
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? "";
  const phone = text.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/)?.[0] ?? "";
  return { email, phone };
}
