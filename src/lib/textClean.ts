/**
 * Text normalisation for JDs, résumés and Resdex cards.
 *
 * Goal: remove NOISE (extraction artefacts, page furniture, boilerplate) while keeping every SIGNAL the scorer needs —
 * skills, experience years/dates, titles, companies, locations, education, projects, notice/CTC. Nothing here rewrites words.
 */

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BULLET_START = /^[\s]*[•●▪▫◦■□►▶➢➤✓✔★☆·‣⁃–—*]\s+/;

/** Unicode/whitespace/bullet/hyphenation clean-up that is always safe. */
export function normalizeText(input: string): string {
  let t = (input ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(ZERO_WIDTH, "")
    .replace(CONTROL, " ")
    .replace(/[  -   　]/g, " ")
    .replace(/[‐‑‒]/g, "-");
  // "develop-\nment" → "development" (only when the continuation is lowercase, so "Full-\nStack" is untouched)
  t = t.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");

  const lines = t.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());

  // Page furniture: "Page 2 of 5", "2/5", bare 1–2 digit lines.
  const isFurniture = (l: string) => /^(page\s*)?\d{1,2}\s*(of|\/)\s*\d{1,2}$/i.test(l) || /^-?\s*\d{1,2}\s*-?$/.test(l);

  // Running headers / footers: the same long-ish line repeated ≥ 3 times (excluding bullets, which are legitimately repeated).
  const freq = new Map<string, number>();
  for (const l of lines) if (l.length >= 10 && l.length <= 90 && !BULLET_START.test(l)) freq.set(l.toLowerCase(), (freq.get(l.toLowerCase()) ?? 0) + 1);
  const furnitureRepeats = new Set([...freq].filter(([, n]) => n >= 3).map(([l]) => l));

  const out: string[] = [];
  for (const l of lines) {
    if (isFurniture(l)) continue;
    if (furnitureRepeats.has(l.toLowerCase())) {
      if (!out.includes(l)) out.push(l); // keep the first occurrence (it may be the candidate's name)
      continue;
    }
    const norm = l.replace(BULLET_START, "- ");
    if (norm && norm === out[out.length - 1]) continue; // consecutive duplicate
    out.push(norm);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ─────────────── résumé ─────────────── */

/** Heading → how safe it is to drop when the text is too long. Lower = dropped first. Anything unmatched is kept. */
const LOW_VALUE_HEADINGS: { re: RegExp; rank: number }[] = [
  { re: /^(declaration|i hereby declare)/i, rank: 0 },
  { re: /^(hobbies|interests|extra[- ]?curricular|personal interests)/i, rank: 1 },
  { re: /^(references?|referees)/i, rank: 2 },
  { re: /^(personal (details|information|profile)|personal data)/i, rank: 3 },
  { re: /^(languages?( known)?)\b/i, rank: 4 },
];
const ANY_HEADING =
  /^(summary|profile|objective|career objective|professional summary|experience|work experience|professional experience|employment( history)?|skills?|technical skills|key skills|core competenc|education|academics?|qualifications?|projects?|certifications?|achievements?|awards?|publications?|declaration|hobbies|interests|references?|personal (details|information)|languages?( known)?)\b/i;

const isHeading = (l: string) => l.length <= 40 && ANY_HEADING.test(l.replace(/^[-\d.\s]+/, "").replace(/[:\s]+$/, ""));

/**
 * Fits a résumé into `maxChars` WITHOUT blindly truncating the tail (education/projects usually live there):
 *  1. always: normalise.
 *  2. over budget: drop low-value sections (declaration, hobbies, references, personal details, languages) one by one.
 *  3. still over: keep the head (summary/skills/experience) and the tail (education/projects) and cut the middle of the longest section.
 */
export function prepareResumeForLlm(raw: string, maxChars = Number(process.env.RESUME_LLM_MAX_CHARS) || 12000): string {
  const text = normalizeText(raw);
  if (text.length <= maxChars) return text;

  const lines = text.split("\n");
  const sections: { head: string; body: string[]; rank: number }[] = [{ head: "", body: [], rank: 99 }];
  for (const l of lines) {
    if (isHeading(l)) {
      const clean = l.replace(/^[-\d.\s]+/, "").replace(/[:\s]+$/, "");
      sections.push({ head: l, body: [], rank: LOW_VALUE_HEADINGS.find((h) => h.re.test(clean))?.rank ?? 99 });
    } else sections[sections.length - 1].body.push(l);
  }
  const size = (s: { head: string; body: string[] }) => s.head.length + s.body.join("\n").length + 2;
  let total = sections.reduce((n, s) => n + size(s), 0);
  const dropped = new Set<number>();
  const order = sections.map((s, i) => ({ i, rank: s.rank })).filter((x) => x.rank < 99).sort((a, b) => a.rank - b.rank);
  for (const { i } of order) {
    if (total <= maxChars) break;
    total -= size(sections[i]);
    dropped.add(i);
  }
  const joined = sections
    .filter((_, i) => !dropped.has(i))
    .map((s) => [s.head, ...s.body].filter(Boolean).join("\n"))
    .join("\n");
  if (joined.length <= maxChars) return joined;

  const headLen = Math.round(maxChars * 0.68);
  const tailLen = maxChars - headLen - 20;
  return `${joined.slice(0, headLen)}\n[…middle trimmed…]\n${joined.slice(-tailLen)}`;
}

/* ─────────────── job description ─────────────── */

const JD_BOILERPLATE: RegExp[] = [
  /equal opportunity employer[^\n]*/gi,
  /we (are|do) (an )?(equal|not discriminate)[^\n]*/gi,
  /(^|\n)\s*(how to apply|apply now|click (the )?apply|send (your )?(cv|resume)[^\n]*)\s*[:.]?[^\n]*/gi,
  /(^|\n)\s*(share this job|follow us on|visit our website)[^\n]*/gi,
];

/** Normalises a JD and strips apply-here / EEO boilerplate that only adds noise to rubric extraction. */
export function prepareJdForLlm(raw: string, maxChars = 20000): string {
  let t = normalizeText(raw);
  for (const re of JD_BOILERPLATE) t = t.replace(re, "\n");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t.length > maxChars ? `${t.slice(0, Math.round(maxChars * 0.8))}\n[…]\n${t.slice(-Math.round(maxChars * 0.2))}` : t;
}

/* ─────────────── Resdex card / profile snippets ─────────────── */

export function prepareCardForLlm(raw: string, maxChars = 2500): string {
  return normalizeText(raw).slice(0, maxChars);
}

/** Best-effort person name from the first plausible line of a résumé (library list before any scoring). */
export function guessName(text: string): string | null {
  for (const l of text.split("\n").slice(0, 8)) {
    const s = l.trim().replace(/^(resume|curriculum vitae|cv)\s*(of|:|-)?\s*/i, "");
    if (/@|\d|http|www\./i.test(s)) continue;
    if (/^[A-Za-z][A-Za-z.'-]+(\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(s) && s.length <= 40 && !isHeading(s)) return s.replace(/\s+/g, " ");
  }
  return null;
}
