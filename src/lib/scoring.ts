import type { Rubric } from "./schemas";

/**
 * Deterministic scoring engine.
 * The LLM never invents the final number: it (a) extracts facts (years, notice, CTC, location) and
 * (b) rates evidence per criterion (0 none · 1 partial · 2 clear). Everything below is plain, testable math.
 */

export type CriterionTier = "must" | "important" | "nice" | "other";
export interface Criterion {
  id: number;
  kind: "skill" | "education" | "cert" | "background" | "responsibility" | "dealbreaker";
  name: string; // short label shown in UI ("React")
  ask: string; // full instruction given to the model
  weight: number;
  tier: CriterionTier;
}

export interface Facts {
  expYears: number;
  noticeDays: number;
  currentCtcLpa: number;
  expectedCtcLpa: number;
  location: string;
}

const lc = (s: string) => s.trim().toLowerCase();

export function buildCriteria(r: Rubric): Criterion[] {
  const out: Criterion[] = [];
  const push = (c: Omit<Criterion, "id">) => out.push({ ...c, id: out.length });
  const aliasesOf = (s: string) => r.skillAliases.find((a) => lc(a.skill) === lc(s))?.aliases ?? [];
  const yearsOf = (s: string) => r.skillMinYears.find((a) => lc(a.skill) === lc(s))?.years ?? -1;

  const skills = (list: string[], weight: number, tier: CriterionTier) => {
    for (const s of list) {
      const al = aliasesOf(s);
      const y = yearsOf(s);
      push({
        kind: "skill",
        name: s,
        tier,
        weight,
        ask:
          `Skill "${s}"` +
          (al.length ? ` (also accept as evidence: ${al.join(", ")})` : "") +
          (y > 0 ? ` — needs ~${y}+ years of hands-on use; rate 1 if used but clearly less` : ""),
      });
    }
  };
  skills(r.mustHaveSkills, 3, "must");
  skills(r.importantSkills, 2, "important");
  skills(r.niceToHaveSkills, 1, "nice");

  if (r.education.trim()) {
    push({ kind: "education", name: `Education: ${r.education}`, tier: r.educationRequired ? "must" : "other", weight: r.educationRequired ? 2 : 1, ask: `Education requirement: ${r.education}` });
  }
  r.certifications.slice(0, 4).forEach((c) => push({ kind: "cert", name: `Cert: ${c}`, tier: "nice", weight: 1, ask: `Certification: ${c}` }));

  const bg = [...r.industries, ...r.companyTypes];
  if (bg.length) {
    push({ kind: "background", name: `Background: ${bg.slice(0, 3).join(", ")}`, tier: "other", weight: 1.5, ask: `Has worked in / for any of: ${bg.join(", ")}` });
  }
  r.responsibilities.slice(0, 5).forEach((x) => push({ kind: "responsibility", name: x, tier: "other", weight: 1, ask: `Has actually done: ${x}` }));
  r.dealBreakers.slice(0, 5).forEach((x) => push({ kind: "dealbreaker", name: x, tier: "other", weight: 0, ask: `DEAL-BREAKER — rate 2 if the candidate IS/HAS this, 0 if clearly not, 1 if unclear: ${x}` }));
  return out;
}

/* ─────────────── numeric fits ─────────────── */

const LOCATION_GROUPS: string[][] = [
  ["bangalore", "bengaluru", "blr"],
  ["delhi", "new delhi", "ncr", "gurgaon", "gurugram", "noida", "greater noida", "faridabad", "ghaziabad"],
  ["mumbai", "navi mumbai", "thane", "bombay"],
  ["hyderabad", "secunderabad", "hyd"],
  ["chennai", "madras"],
  ["pune", "pimpri", "chinchwad"],
  ["kolkata", "calcutta"],
];

function locTokens(s: string): Set<string> {
  const text = lc(s);
  const found = new Set<string>();
  for (const g of LOCATION_GROUPS) if (g.some((a) => new RegExp(`\\b${a}\\b`).test(text))) found.add(g[0]);
  for (const part of text.split(/[,/|;]+/).map((p) => p.trim()).filter(Boolean)) found.add(part);
  return found;
}

interface NumFit {
  key: "experience" | "notice" | "ctc" | "location";
  label: string;
  weight: number;
  credit: number; // 0..1
  known: boolean;
  evidence: string;
}

export function numericFits(r: Rubric, f: Facts): NumFit[] {
  const fits: NumFit[] = [];

  // Experience
  if (r.minExperienceYears >= 0 || r.maxExperienceYears >= 0) {
    const min = r.minExperienceYears;
    const max = r.maxExperienceYears;
    const range = min >= 0 && max >= 0 ? `${min}–${max} yrs` : min >= 0 ? `${min}+ yrs` : `≤ ${max} yrs`;
    let credit = 0.5;
    const known = f.expYears >= 0;
    if (known) {
      const e = f.expYears;
      if (min >= 0 && e < min) {
        const gap = min - e;
        credit = gap <= 0.5 ? 0.9 : gap <= 1 ? 0.7 : gap <= 2 ? 0.4 : 0.05;
      } else if (max >= 0 && e > max) {
        const over = e - max;
        credit = over <= 2 ? 0.85 : over <= 4 ? 0.6 : 0.35; // over-qualified: costlier & flight risk, but still capable
      } else credit = 1;
    }
    fits.push({ key: "experience", label: `Experience ${range}`, weight: 3, credit, known, evidence: known ? `${f.expYears} yrs` : "Not stated" });
  }

  // Notice period
  {
    const max = r.maxNoticePeriodDays;
    const known = f.noticeDays >= 0;
    let credit = 0.5;
    if (known) {
      const d = f.noticeDays;
      if (max >= 0) credit = d <= max ? 1 : d <= max + 15 ? 0.6 : d <= max + 30 ? 0.3 : 0.1;
      else credit = d <= 15 ? 1 : d <= 30 ? 0.85 : d <= 60 ? 0.55 : 0.3; // no stated limit → sooner is better
    }
    fits.push({
      key: "notice",
      label: max >= 0 ? `Notice ≤ ${max} days` : "Notice period",
      weight: max >= 0 ? 1.5 : 0.75,
      credit,
      known,
      evidence: known ? (f.noticeDays === 0 ? "Immediate" : `${f.noticeDays} days`) : "Not stated",
    });
  }

  // CTC (compare expected; fall back to current + 25% hike)
  if (r.ctcBudgetMaxLpa >= 0) {
    const eff = f.expectedCtcLpa >= 0 ? f.expectedCtcLpa : f.currentCtcLpa >= 0 ? f.currentCtcLpa * 1.25 : -1;
    const known = eff >= 0;
    const b = r.ctcBudgetMaxLpa;
    const credit = !known ? 0.5 : eff <= b ? 1 : eff <= b * 1.1 ? 0.75 : eff <= b * 1.25 ? 0.35 : 0.05;
    fits.push({
      key: "ctc",
      label: `CTC ≤ ${b} LPA`,
      weight: 1.5,
      credit,
      known,
      evidence: known ? `${f.expectedCtcLpa >= 0 ? "Expects" : "Current ≈"} ${Math.round(eff * 10) / 10} LPA` : "Not disclosed",
    });
  }

  // Location
  if (r.locations.length && r.remotePolicy !== "remote") {
    const known = !!f.location.trim();
    let credit = 0.5;
    if (known) {
      const cand = locTokens(f.location);
      const want = r.locations.flatMap((l) => [...locTokens(l)]);
      credit = want.some((w) => cand.has(w)) ? 1 : r.remotePolicy === "flexible" ? 0.6 : 0.25;
    }
    fits.push({ key: "location", label: `Location ${r.locations.join("/")}`, weight: 1.5, credit, known, evidence: known ? f.location : "Not stated" });
  }
  return fits;
}

/* ─────────────── final score ─────────────── */

export interface ScoreResult {
  score: number;
  matched: string[];
  missing: string[];
  flags: string[];
  numeric: NumFit[];
}

const lvl = (n: number) => (n >= 2 ? 2 : n >= 1 ? 1 : 0);

/**
 * mode "card": Resdex cards are truncated snippets, so "no evidence" is weak evidence of absence → small residual credit and softer gates.
 * mode "deep": full profile → absence counts fully.
 */
export function computeScore(r: Rubric, criteria: Criterion[], levels: number[], facts: Facts, mode: "card" | "deep"): ScoreResult {
  const zero = mode === "card" ? 0.15 : 0;
  let num = 0;
  let den = 0;
  let mustNum = 0;
  let mustDen = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  const flags: string[] = [];
  let dealBreaker = false;

  criteria.forEach((c, i) => {
    const l = lvl(levels[i] ?? 0);
    if (c.kind === "dealbreaker") {
      if (l === 2) {
        dealBreaker = true;
        flags.push(`Deal-breaker: ${c.name}`);
      }
      return;
    }
    const credit = l === 2 ? 1 : l === 1 ? 0.5 : zero;
    num += c.weight * credit;
    den += c.weight;
    if (c.tier === "must") {
      mustNum += c.weight * credit;
      mustDen += c.weight;
    }
    if (c.kind === "skill") {
      if (l === 2) matched.push(c.name);
      else if (l === 1 && c.tier !== "nice") missing.push(`${c.name} (partial)`);
      else if (l === 0 && c.tier !== "nice") missing.push(c.name);
    }
  });

  const numeric = numericFits(r, facts);
  for (const n of numeric) {
    num += n.weight * n.credit;
    den += n.weight;
    if (n.known && n.credit <= 0.35) {
      flags.push(
        n.key === "experience" ? `Experience ${facts.expYears} yrs vs ${n.label.replace("Experience ", "")}` :
        n.key === "notice" ? `Notice ${facts.noticeDays} days is above the limit` :
        n.key === "ctc" ? `Expected CTC above budget (${n.evidence})` :
        `Location mismatch (${facts.location})`,
      );
    }
  }

  let score = den > 0 ? (100 * num) / den : 0;

  // Gates — a candidate missing the core requirements can't look "good" just because the soft factors are great.
  const cov = mustDen > 0 ? mustNum / mustDen : 1;
  if (mode === "deep") {
    if (cov < 0.25) score = Math.min(score, 35);
    else if (cov < 0.5) score = Math.min(score, 55);
  } else {
    if (cov < 0.3) score = Math.min(score, 42);
    else if (cov < 0.55) score = Math.min(score, 58);
  }
  const exp = numeric.find((n) => n.key === "experience");
  if (exp && exp.known && exp.credit <= 0.1) score = Math.min(score, 55); // far below the minimum
  else if (exp && exp.known && exp.credit <= 0.35) score = Math.min(score, 75); // >2 yrs under, or >4 yrs over the range
  const ctc = numeric.find((n) => n.key === "ctc");
  if (ctc && ctc.known && ctc.credit <= 0.1) score = Math.min(score, 65); // >25% over budget
  const notice = numeric.find((n) => n.key === "notice");
  if (notice && notice.known && notice.credit <= 0.1) score = Math.min(score, 70); // 30+ days beyond the limit
  if (dealBreaker) score = Math.min(score, 30);

  return { score: Math.max(0, Math.min(100, Math.round(score))), matched, missing, flags, numeric };
}

export function fitOf(n?: { known: boolean; credit: number }): "good" | "ok" | "risk" | "unknown" {
  if (!n || !n.known) return "unknown";
  return n.credit >= 0.9 ? "good" : n.credit >= 0.5 ? "ok" : "risk";
}

export function ctcString(f: Facts): string {
  const c = f.currentCtcLpa >= 0 ? `Current ${f.currentCtcLpa}` : "";
  const e = f.expectedCtcLpa >= 0 ? `Expected ${f.expectedCtcLpa}` : "";
  return c || e ? `${[c, e].filter(Boolean).join(" / ")} LPA` : "Not disclosed";
}
