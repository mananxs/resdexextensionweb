import Groq from "groq-sdk";
import type { ZodType, ZodTypeDef } from "zod";
import { AuditJSON, AuditLLMZ, BatchJSON, BatchOutZ, RubricJSON, RubricZ, type Audit, type Rubric } from "./schemas";
import { buildBooleanQuery, sanitizeBooleanQuery, MAX_BOOLEAN_CHARS } from "./resdexQuery";
import { buildCriteria, computeScore, ctcString, fitOf, type Criterion, type Facts, type Worth } from "./scoring";
import { tierFor } from "./tier";

export const MODELS = {
  rubric: "openai/gpt-oss-120b", // deep requirement extraction + critic pass
  batch: "openai/gpt-oss-20b", // ~1000 tok/s real-time scoring
  deep: "openai/gpt-oss-120b", // single-profile audit
} as const;

let _client: Groq | null = null;
function client(): Groq {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set on the server");
  return (_client ??= new Groq({ apiKey: process.env.GROQ_API_KEY.trim(), maxRetries: 2 }));
}

/* ─────────────── Shared Indian-recruitment prompt rules ─────────────── */

const INDIA_RULES = `
You are a meticulous senior Indian technical recruiter's assistant. Apply Indian hiring conventions:

SKILL MATCHING (semantic, evidence-based — not keyword counting):
- Equivalence/implication counts as evidence: Next.js/Gatsby/Remix ⇒ React; React Native ⇒ React; TypeScript ⇒ JavaScript;
  Spring Boot ⇒ Java + Spring; Django/Flask/FastAPI ⇒ Python; Express/NestJS ⇒ Node.js; EKS/AKS/GKE ⇒ Kubernetes;
  PySpark ⇒ Spark + Python; Redshift/BigQuery/Snowflake ⇒ cloud data warehouse; MERN ⇒ MongoDB+Express+React+Node.
- Accept abbreviations/spellings (JS, TS, K8s, GCP, AWS, ReactJS = React, Node = Node.js, Postgres = PostgreSQL).
- Credit a skill only when the candidate text supports it (skills list, job description, projects, designation). Never invent skills.
- Judge SENIORITY of use: "led/architected/owned" > "worked on". Years-of-skill requirements must be compared to the evidence given.

NOTICE PERIOD (India): "Immediate"/"Serving notice"/"Available now" = 0 days; "15 Days"; "1 Month"=30; "2 Months"=60; "3 Months"=90.
COMPENSATION: LPA (lakhs per annum, INR). "12.5 Lacs" = 12.5 LPA; "1 Cr" = 100 LPA; monthly figures ×12.
EXPERIENCE: total years (e.g. "6 Yrs 3 Months" = 6.25). LOCATION: Bengaluru = Bangalore; NCR includes Gurgaon/Gurugram/Noida/Delhi.
Resdex text may be abbreviated, truncated or have masked contact info — report only what is present; never fabricate.
Use -1 for unknown numbers and "" (or "Not mentioned") for unknown strings. Output must follow the supplied JSON schema exactly.
`.trim();

/* ─────────────── Structured-output call ─────────────── */

interface StructuredArgs<T> {
  model: string;
  name: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  zod: ZodType<T, ZodTypeDef, unknown>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

const EFFORTS = ["low", "medium", "high"] as const;

/** Groq's "json_validate_failed" (empty or truncated generation) — almost always the reasoning ate the token budget. */
function isJsonFailure(e: unknown) {
  const err = e as { status?: number; message?: string };
  return err.status === 400 && /json_validate_failed|Failed to (validate|generate) JSON/i.test(err.message ?? "");
}

async function structured<T>(a: StructuredArgs<T>): Promise<T> {
  let lastErr: unknown;
  let maxTokens = a.maxTokens;
  let effort = a.effort;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await client().chat.completions.create({
        model: a.model,
        temperature: 0.1,
        max_completion_tokens: maxTokens,
        reasoning_effort: effort,
        messages: [
          { role: "system", content: a.system },
          { role: "user", content: a.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: a.name, strict: true, schema: a.jsonSchema } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (res as any).choices?.[0]?.message?.content as string | undefined;
      if (!content) throw Object.assign(new Error("Empty response from Groq"), { retryable: true });
      return a.zod.parse(JSON.parse(content));
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      if (isJsonFailure(e) || (e as { retryable?: boolean }).retryable || e instanceof SyntaxError) {
        // Escalate: more room for the answer, less reasoning.
        maxTokens = Math.min(16000, Math.round(maxTokens * 1.7));
        effort = EFFORTS[Math.max(0, EFFORTS.indexOf(effort) - 1)];
        continue;
      }
      if (status && status !== 429 && status < 500) break; // non-retryable (auth, bad request)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Groq call failed");
}

/* ─────────────── 1. JD rubric extraction: extract → critique/refine (120B) ─────────────── */

const RUBRIC_SPEC = `
Fields:
- title, department ("" if unclear), seniority.
- mustHaveSkills: HARD requirements — anything labelled must/required/mandatory/"should have", and every unqualified item in a Requirements/Qualifications list. Canonical short names (max 12).
- importantSkills: strongly preferred, or core to the stated responsibilities but not labelled mandatory (max 8).
- niceToHaveSkills: "good to have / preferred / bonus / plus" only (max 8). A skill appears in exactly ONE of the three lists.
- skillMinYears: only where the JD ties years to a specific skill ("3+ years of React" → {skill:"React", years:3}).
- skillAliases: for each must/important skill, 2–5 equivalents/implied terms a candidate profile might use instead (e.g. React → Next.js, ReactJS, React Native).
- min/maxExperienceYears (overall; max=-1 if open-ended), maxNoticePeriodDays ("immediate joiners"=0; -1 if not stated), ctcBudgetMin/MaxLpa (convert to LPA).
- education + educationRequired (true only if the JD insists on a degree), certifications, industries (domains the person should have worked in), companyTypes ("product", "startup", "MNC", "SaaS", "service"…).
- responsibilities: up to 5 key things the person must actually have DONE (verb phrases, e.g. "Designed event-driven microservices at scale").
- dealBreakers: explicit exclusions or hard negatives in the JD ("no freshers", "not from pure service companies", "no job-hoppers <1 yr"). Empty if none stated — do NOT invent.
- locations (normalised city names), remotePolicy, domainContext (1–2 sentences).
- targetTitles: 4–6 alternate designations a matching candidate may currently hold (incl. adjacent seniority).
- searchVariants: EXACTLY 3 plain-text Resdex keyword strings, NO Boolean operators/quotes/parentheses, each ≤ 6 words:
    "Precise"  = best-fit title + the 2 scarcest must-have skills (small, very relevant pool)
    "Balanced" = the 4–5 highest-signal must-have skills (+ title word if useful)
    "Wide"     = alternate title/synonym + 1–2 key skills (large pool for recall)
  Prefer terms that appear on real profiles; skip ubiquitous skills (Git, Agile, MS Office) and soft skills.
- coreKeywords: 3–5 short single keywords/titles (same spirit, no operators).
- RESDEX SEARCH PARAMETERS (used to pre-fill the Naukri Resdex search form; they are NOT scoring inputs):
    mustHaveKeywords: the 3–5 NON-NEGOTIABLE skills/titles (subset of mustHaveSkills, scarcest first). Short canonical terms.
    excludeKeywords: 0–5 negative keywords that remove false positives for THIS role (e.g. "Manual Testing" for an automation role, "Intern", "Trainee"). Only terms that would never appear on a good profile. [] if unsure — do NOT invent.
    booleanQuery: ONE Resdex-compatible Boolean string, ≤ ${MAX_BOOLEAN_CHARS} characters:
      • join the mustHaveKeywords with AND; wrap each skill with its 1–3 strongest synonyms/aliases in parentheses joined by OR, e.g. (React OR ReactJS OR "React.js") AND (Node.js OR NodeJS) AND AWS
      • append the excludeKeywords as NOT (x OR y)
      • double-quote multi-word terms; uppercase AND/OR/NOT; balanced parentheses; no experience, salary, notice or location words in the string.
    minExp / maxExp: overall experience range in years for the Resdex min/max boxes (same meaning as minExperienceYears/maxExperienceYears; -1 if not stated).
Use -1 for any unstated number, "" for unstated strings, [] for unstated lists.`.trim();

export async function extractRubric(rawJd: string): Promise<Rubric> {
  const jd = rawJd.slice(0, 20000);

  // Pass 1 — thorough extraction
  const draft = await structured({
    model: MODELS.rubric,
    name: "jd_rubric",
    jsonSchema: RubricJSON,
    zod: RubricZ,
    maxTokens: 8000,
    effort: "medium",
    system: `${INDIA_RULES}\n\nTASK: Read EVERY sentence of the job description and convert it into a precise evaluation rubric. Nothing in the JD should be lost, and nothing should be invented.\n${RUBRIC_SPEC}`,
    user: `JOB DESCRIPTION:\n"""\n${jd}\n"""`,
  });

  // Pass 2 — independent critic: find omissions / wrong priorities, return the corrected rubric.
  let final = draft;
  try {
    final = await structured({
      model: MODELS.rubric,
      name: "jd_rubric_refined",
      jsonSchema: RubricJSON,
      zod: RubricZ,
      maxTokens: 8000,
      effort: "low",
      system: `${INDIA_RULES}\n\nTASK: You are a strict reviewer of a draft rubric extracted from a JD. Re-read the JD line by line and fix the draft:
1. Any requirement, tool, responsibility, qualification, number (years/CTC/notice) or location in the JD that is missing → add it.
2. Wrong priority (e.g. a mandatory item listed as nice-to-have, or vice-versa) → move it. A skill must be in only one list.
3. Skills that are only implied by the responsibilities → importantSkills.
4. Invented or unsupported items → remove. Tighten duplicate/overlapping items.
5. Verify the 3 search variants are plain keywords, high-signal and genuinely different in breadth.
Return the FULL corrected rubric.\n${RUBRIC_SPEC}`,
      user: `JOB DESCRIPTION:\n"""\n${jd}\n"""\n\nDRAFT RUBRIC:\n${JSON.stringify(draft)}`,
    });
  } catch {
    /* keep the draft if the refine pass fails/rate-limits */
  }
  return normalizeRubric(final);
}

const BOOL_CHARS = /\b(AND|OR|NOT)\b|[()"]/g;
const cleanKw = (s: string) => s.replace(BOOL_CHARS, " ").replace(/\s+/g, " ").trim();
function dedupe(a: string[], max = 50) {
  const seen = new Set<string>();
  return a
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, max);
}

function normalizeRubric(r: Rubric): Rubric {
  const must = dedupe(r.mustHaveSkills, 12);
  const taken = new Set(must.map((s) => s.toLowerCase()));
  const important = dedupe(r.importantSkills, 8).filter((s) => !taken.has(s.toLowerCase()));
  important.forEach((s) => taken.add(s.toLowerCase()));
  const nice = dedupe(r.niceToHaveSkills, 8).filter((s) => !taken.has(s.toLowerCase()));
  const variants = r.searchVariants
    .map((v) => ({ label: v.label.trim() || "Search", keywords: cleanKw(v.keywords) }))
    .filter((v) => v.keywords)
    .slice(0, 3);
  const core = dedupe(r.coreKeywords.map(cleanKw).filter(Boolean), 5);

  // ── Resdex search parameters ──
  const mustLc = new Set(must.map((s) => s.toLowerCase()));
  let mustKw = dedupe(r.mustHaveKeywords.map((s) => s.replace(/["()]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean), 5);
  if (mustKw.length < 3) mustKw = dedupe([...mustKw, ...must], 5); // top up from the must-have skills
  const exclude = dedupe(
    r.excludeKeywords.map((s) => s.replace(/["()]/g, " ").replace(/\s+/g, " ").trim()).filter((s) => s && !mustLc.has(s.toLowerCase()) && !mustKw.some((m) => m.toLowerCase() === s.toLowerCase())),
    5,
  );
  const aliases = r.skillAliases.filter((x) => x.skill && x.aliases.length).map((x) => ({ skill: x.skill, aliases: dedupe(x.aliases, 6) }));
  // Trust the model's query only if it is balanced, short enough and not truncated; otherwise rebuild deterministically.
  const booleanQuery =
    sanitizeBooleanQuery(r.booleanQuery) || buildBooleanQuery({ mustHaveSkills: must, mustHaveKeywords: mustKw, excludeKeywords: exclude, skillAliases: aliases });
  const minExp = r.minExp >= 0 ? r.minExp : r.minExperienceYears;
  const maxExp = r.maxExp >= 0 ? r.maxExp : r.maxExperienceYears;

  return {
    ...r,
    booleanQuery,
    mustHaveKeywords: mustKw,
    excludeKeywords: exclude,
    minExp,
    maxExp,
    mustHaveSkills: must,
    importantSkills: important,
    niceToHaveSkills: nice,
    skillMinYears: r.skillMinYears.filter((x) => x.skill && x.years > 0),
    skillAliases: r.skillAliases.filter((x) => x.skill && x.aliases.length).map((x) => ({ skill: x.skill, aliases: dedupe(x.aliases, 6) })),
    certifications: dedupe(r.certifications, 4),
    industries: dedupe(r.industries, 5),
    companyTypes: dedupe(r.companyTypes, 4),
    responsibilities: dedupe(r.responsibilities, 5),
    dealBreakers: dedupe(r.dealBreakers, 5),
    targetTitles: dedupe(r.targetTitles, 6),
    searchVariants: variants,
    coreKeywords: core.length ? core : variants[0]?.keywords.split(" ").slice(0, 4) ?? [],
  };
}

/* ─────────────── criteria prompt block ─────────────── */

function criteriaBlock(criteria: Criterion[]): string {
  return criteria.map((c) => `${c.id}. [${c.tier === "other" ? (c.kind === "dealbreaker" ? "DEAL-BREAKER" : "INFO") : c.tier.toUpperCase()}] ${c.ask}`).join("\n");
}
const LEVEL_RULES = `Level scale per criterion: 0 = no evidence / absent, 1 = partial, related or weaker than required, 2 = clear evidence. For DEAL-BREAKER rows: 2 = the candidate IS/HAS it, 0 = clearly not, 1 = unclear.`;

const num = (n: number) => (Number.isFinite(n) ? n : -1);

/* ─────────────── 2. Batch card scoring (20B) ─────────────── */

export interface ScoredCard {
  domId: string;
  score: number;
  tier: string;
  /** "Worth 1 CV View" recommendation: open = High Priority · review = Borderline · skip = Save Quota */
  worth: Worth;
  worthReasons: string[];
  /** Facts read off the card itself — lets the extension save a card without opening the profile. */
  extracted: {
    fullName: string;
    currentRole: string;
    currentCompany: string;
    headline: string;
    skills: string[];
    expYears: number;
    currentCtcLpa: number;
    expectedCtcLpa: number;
    location: string;
  };
  matchedSkills: string[];
  missingSkills: string[];
  noticePeriod: string;
  noticeDays: number;
  ctc: string;
  oneLineVerdict: string;
  flags: string[];
}

/**
 * Scores a batch; if the model can't produce valid JSON for it (too big / too much reasoning), the batch is
 * split in half and retried so one bad card can't sink the whole page. A single card that still fails is reported as `missing`.
 */
export async function scoreBatch(
  rubric: Rubric,
  cards: { domId: string; rawText: string }[],
): Promise<{ results: ScoredCard[]; missing: string[] }> {
  try {
    return await scoreBatchOnce(rubric, cards);
  } catch (e) {
    const err = e as { status?: number };
    const recoverable = isJsonFailure(e) || e instanceof SyntaxError || /Empty response|Zod|invalid/i.test((e as Error).message ?? "");
    if (!recoverable || err.status === 429) throw e;
    if (cards.length <= 1) return { results: [], missing: cards.map((c) => c.domId) };
    const mid = Math.ceil(cards.length / 2);
    const [a, b] = [await scoreBatch(rubric, cards.slice(0, mid)), await scoreBatch(rubric, cards.slice(mid))];
    return { results: [...a.results, ...b.results], missing: [...a.missing, ...b.missing] };
  }
}

async function scoreBatchOnce(
  rubric: Rubric,
  cards: { domId: string; rawText: string }[],
): Promise<{ results: ScoredCard[]; missing: string[] }> {
  const criteria = buildCriteria(rubric);
  const N = criteria.length;
  const body = cards.map((c) => `<<<CARD domId="${c.domId}">>>\n${c.rawText.slice(0, 2500)}\n<<<END CARD>>>`).join("\n\n");

  const out = await structured({
    model: MODELS.batch,
    name: "batch_candidate_facts",
    jsonSchema: BatchJSON,
    zod: BatchOutZ,
    maxTokens: Math.min(10000, 400 * cards.length + 600),
    effort: "low",
    system: `${INDIA_RULES}

TASK: For EVERY candidate card (echo its domId verbatim) do two things:
A) Extract FACTS from EVERY visible field of the card — fullName, currentRole (current designation), currentCompany, headline (profile headline / one-line summary, ≤ 25 words, "" if none),
   skills (the key skills visibly listed, ≤ 12, as written), expYears, noticePeriod text + noticeDays, currentCtcLpa, expectedCtcLpa, location (-1 / "" if absent). Copy names/roles/companies verbatim; never guess.
B) Rate each criterion below. "levels" must contain EXACTLY ${N} integers, in criterion order (index 0..${N - 1}). ${LEVEL_RULES}
Cards are short snippets: judge from the skills list, designation, company, headline, summary, experience, CTC, notice period and location together — a skill only in a "preferred" list is weaker than one in the current designation or summary.
Also give oneLineVerdict (≤ 18 words, name the strongest match and the biggest gap; do NOT state a numeric score).

CRITERIA:
${criteriaBlock(criteria)}`,
    user: `CANDIDATE CARDS:\n${body}`,
  });

  const wanted = new Set(cards.map((c) => c.domId));
  const seen = new Set<string>();
  const results: ScoredCard[] = [];
  for (const r of out.results) {
    if (!wanted.has(r.domId) || seen.has(r.domId)) continue;
    if (r.levels.length !== N) continue; // malformed → reported as missing so the extension retries
    seen.add(r.domId);
    const facts: Facts = {
      expYears: num(r.expYears),
      noticeDays: num(r.noticeDays),
      currentCtcLpa: num(r.currentCtcLpa),
      expectedCtcLpa: num(r.expectedCtcLpa),
      location: r.location,
    };
    const s = computeScore(rubric, criteria, r.levels, facts, "card");
    results.push({
      domId: r.domId,
      score: s.score,
      tier: tierFor(s.score),
      worth: s.worth,
      worthReasons: s.worthReasons,
      extracted: {
        fullName: r.fullName.trim(),
        currentRole: r.currentRole.trim(),
        currentCompany: r.currentCompany.trim(),
        headline: r.headline.trim(),
        skills: r.skills.slice(0, 12),
        expYears: facts.expYears,
        currentCtcLpa: facts.currentCtcLpa,
        expectedCtcLpa: facts.expectedCtcLpa,
        location: r.location.trim(),
      },
      matchedSkills: s.matched.slice(0, 6),
      missingSkills: s.missing.slice(0, 6),
      noticePeriod: r.noticePeriod || "Not mentioned",
      noticeDays: facts.noticeDays,
      ctc: ctcString(facts),
      oneLineVerdict: r.oneLineVerdict,
      flags: s.flags.slice(0, 3),
    });
  }
  return { results, missing: cards.map((c) => c.domId).filter((id) => !seen.has(id)) };
}

/* ─────────────── 3. Deep single-profile audit (120B) ─────────────── */

export async function auditProfile(rubric: Rubric, rawText: string): Promise<Audit & { tier: string }> {
  const criteria = buildCriteria(rubric);
  const llm = await structured({
    model: MODELS.deep,
    name: "profile_audit",
    jsonSchema: AuditJSON,
    zod: AuditLLMZ,
    maxTokens: 5000,
    effort: "medium",
    system: `${INDIA_RULES}

TASK: Audit ONE candidate profile against the criteria below.
- extracted: identity/contact facts verbatim from the text (fullName, currentRole, currentCompany, location, email, phone; "" when masked/absent); totalExpYears, currentCtcLpa, expectedCtcLpa (-1 if unknown); noticePeriod + noticeDays.
- checks: one entry per criterion id (0..${criteria.length - 1}) with level and a SHORT evidence quote/paraphrase from the profile (≤ 14 words; "No evidence" if level 0). ${LEVEL_RULES}
- strengths: 3–5 concrete, evidence-based bullets. risks: 2–4 bullets (job-hopping, gaps, stack staleness, seniority mismatch, counter-offer/relocation risks).
- noticeNote / ctcNote / experienceNote: one sentence each vs. the JD limits (mention buy-out/negotiability for 60–90 day notice).
- interviewQuestions: EXACTLY 3 tailored questions that probe the biggest gaps/partial must-haves and verify the strongest claims.
- verdict: 2 sentences — screen/hire recommendation with reasoning (no numeric score).

JD CONTEXT: ${rubric.domainContext || rubric.title}; experience ${rubric.minExperienceYears}–${rubric.maxExperienceYears} yrs; notice ≤ ${rubric.maxNoticePeriodDays} days; budget ${rubric.ctcBudgetMinLpa}–${rubric.ctcBudgetMaxLpa} LPA; locations ${rubric.locations.join(", ") || "any"} (${rubric.remotePolicy}). (-1 = not stated)

CRITERIA:
${criteriaBlock(criteria)}`,
    user: `CANDIDATE PROFILE TEXT:\n"""\n${rawText.slice(0, 9000)}\n"""`,
  });

  const x = llm.extracted;
  const facts: Facts = {
    expYears: num(x.totalExpYears),
    noticeDays: num(x.noticeDays),
    currentCtcLpa: num(x.currentCtcLpa),
    expectedCtcLpa: num(x.expectedCtcLpa),
    location: x.location,
  };
  const levels = criteria.map((c) => llm.checks.find((k) => k.id === c.id)?.level ?? 0);
  const s = computeScore(rubric, criteria, levels, facts, "deep");

  const checks = [
    ...criteria
      .filter((c) => c.kind !== "dealbreaker")
      .map((c) => ({
        label: c.name,
        tier: c.tier,
        level: Math.max(0, Math.min(2, Math.round(levels[c.id]))),
        evidence: llm.checks.find((k) => k.id === c.id)?.evidence ?? "",
      })),
    ...s.numeric.map((n) => ({ label: n.label, tier: "fit", level: n.credit >= 0.9 ? 2 : n.credit >= 0.5 ? 1 : 0, evidence: n.evidence })),
  ];
  const contact = scrapeContact(rawText);

  return {
    extracted: { ...x, email: x.email || contact.email, phone: x.phone || contact.phone },
    score: s.score,
    tier: tierFor(s.score),
    matchedSkills: s.matched,
    missingSkills: s.missing,
    strengths: llm.strengths,
    risks: llm.risks,
    noticeFit: fitOf(s.numeric.find((n) => n.key === "notice")),
    noticeNote: llm.noticeNote,
    ctcFit: fitOf(s.numeric.find((n) => n.key === "ctc")),
    ctcNote: llm.ctcNote,
    experienceNote: llm.experienceNote,
    interviewQuestions: llm.interviewQuestions.slice(0, 3),
    verdict: llm.verdict,
    checks,
    flags: s.flags,
  };
}

export function scrapeContact(text: string) {
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? "";
  const phone = text.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/)?.[0] ?? "";
  return { email, phone };
}
