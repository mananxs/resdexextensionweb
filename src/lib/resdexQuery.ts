// Client-safe helpers (no server imports): Resdex Boolean query building/validation + search-field resolution.
import type { Rubric } from "./schemas";

/** Resdex truncates very long keyword strings; stay well below that. */
export const MAX_BOOLEAN_CHARS = 380;

const OPS = /^(AND|OR|NOT)$/i;

/** Quote multi-word / special-character terms so Resdex treats them as a phrase. Never double-quotes. */
function term(raw: string): string {
  const t = raw.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || OPS.test(t)) return "";
  return /[\s]/.test(t) ? `"${t}"` : t;
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  return list
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

export function isBalanced(q: string): boolean {
  let depth = 0;
  let inQuote = false;
  for (const ch of q) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "(") depth++;
    else if (!inQuote && ch === ")" && --depth < 0) return false;
  }
  return depth === 0 && !inQuote;
}

/** Uppercase operators, collapse whitespace. Returns "" when the query is unusable (unbalanced, dangling operator, too long). */
export function sanitizeBooleanQuery(q: string | undefined | null): string {
  if (!q) return "";
  const s = q
    .replace(/\s+/g, " ")
    .replace(/\b(and|or|not)\b/g, (m) => m.toUpperCase())
    .trim();
  if (!s || s.length > MAX_BOOLEAN_CHARS || !isBalanced(s)) return "";
  if (/^(AND|OR)\b|\b(AND|OR|NOT)$/.test(s)) return ""; // dangling operator
  if (/\b(AND|OR|NOT)\s+(AND|OR)\b/.test(s)) return "";
  return s;
}

type QueryInput = Pick<Rubric, "mustHaveSkills" | "mustHaveKeywords" | "excludeKeywords" | "skillAliases">;

/**
 * Deterministic fallback / repair: (A OR aliasA) AND (B OR aliasB) … NOT (x OR y).
 * Sheds aliases, then excludes, then trailing must-haves until it fits MAX_BOOLEAN_CHARS.
 */
export function buildBooleanQuery(r: QueryInput): string {
  const core = uniq(r.mustHaveKeywords.length ? r.mustHaveKeywords : r.mustHaveSkills).slice(0, 5);
  if (!core.length) return "";
  const aliasOf = (s: string) => r.skillAliases.find((a) => a.skill.trim().toLowerCase() === s.toLowerCase())?.aliases ?? [];
  const excludes = uniq(r.excludeKeywords).slice(0, 5);

  const assemble = (nCore: number, nAlias: number, nExcl: number) => {
    const groups = core.slice(0, nCore).map((s) => {
      const alts = uniq([s, ...aliasOf(s).slice(0, nAlias)]).map(term).filter(Boolean);
      return alts.length > 1 ? `(${alts.join(" OR ")})` : alts[0] ?? "";
    });
    let q = groups.filter(Boolean).join(" AND ");
    const ex = excludes.slice(0, nExcl).map(term).filter(Boolean);
    if (q && ex.length) q += ex.length > 1 ? ` NOT (${ex.join(" OR ")})` : ` NOT ${ex[0]}`;
    return q;
  };

  for (const nCore of [core.length, Math.min(core.length, 4), 3, 2, 1]) {
    for (const nExcl of [excludes.length, Math.min(excludes.length, 2), 0]) {
      for (const nAlias of [3, 2, 1, 0]) {
        const q = assemble(nCore, nAlias, nExcl);
        if (q && q.length <= MAX_BOOLEAN_CHARS) return q;
      }
    }
  }
  return term(core[0]);
}

export interface ResdexSearchParams {
  booleanQuery: string;
  minExp: number | null;
  maxExp: number | null;
  locations: string[];
}

const nn = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

/**
 * Single place that resolves the Resdex fields for ANY stored rubric (old or new):
 * old rows have no booleanQuery/minExp → rebuilt from mustHaveSkills + minExperienceYears.
 */
export function resdexSearchParams(r: Rubric): ResdexSearchParams {
  const q = sanitizeBooleanQuery(r.booleanQuery) || buildBooleanQuery(r);
  return {
    booleanQuery: q,
    minExp: nn(r.minExp) ?? nn(r.minExperienceYears),
    maxExp: nn(r.maxExp) ?? nn(r.maxExperienceYears),
    locations: r.locations.filter(Boolean).slice(0, 5),
  };
}
