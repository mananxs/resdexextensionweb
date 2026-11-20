// Client-safe helpers (no server imports).

export type Tier = "Top Match" | "Good Fit" | "Low Match";

export function tierFor(score: number): Tier {
  if (score >= 80) return "Top Match";
  if (score >= 60) return "Good Fit";
  return "Low Match";
}

export function tierClasses(score: number): string {
  if (score >= 80) return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  if (score >= 60) return "bg-amber-100 text-amber-800 ring-amber-200";
  return "bg-rose-100 text-rose-800 ring-rose-200";
}

/** "Immediate" → 0, "30 days" → 30, "2 months" → 60, "3 weeks" → 21, unknown → null */
export function noticeToDays(text?: string | null): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/immediate|serving|available now|0\s*day/.test(t)) return 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(day|d\b|week|wk|month|mo)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2].startsWith("week") || m[2] === "wk") return Math.round(n * 7);
  if (m[2].startsWith("mo")) return Math.round(n * 30);
  return Math.round(n);
}
