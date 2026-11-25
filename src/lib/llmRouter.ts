import Groq from "groq-sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ZodType, ZodTypeDef } from "zod";
import { sha1 } from "./crypto";

/**
 * Centralised LLM router.
 *
 *  • KEY POOLS   Shared server keys come from env (GROQ_API_KEYS / GEMINI_API_KEYS comma- or newline-separated, plus
 *                GROQ_API_KEY, GROQ_API_KEY_1..50, GEMINI_API_KEY, GEMINI_API_KEY_1..50). An HR can ALSO bring their own keys:
 *                `runWithLlmContext({ groqKeys, geminiKeys, useShared })` scopes them to one request (AsyncLocalStorage), and they are tried
 *                BEFORE the shared pool. `useShared:false` = never spend the shared pool for that HR.
 *  • ROTATION    least-loaded / least-recently-used among healthy keys.
 *  • COOLDOWN    429 / quota → key cools down for `retry-after` (header, or Gemini RetryInfo) or exponential backoff. 401/403 → 10 min. 5xx / network → short backoff.
 *  • PROACTIVE   Groq `x-ratelimit-remaining-requests/-tokens` below a threshold → the key is parked until its `x-ratelimit-reset-*` BEFORE it 429s.
 *  • FAILOVER    provider order (LLM_PROVIDER_ORDER, default groq,gemini): when every key of one provider is parked/failed, the call moves to the next.
 *  • JSON REPAIR truncated / invalid JSON → retry with more output tokens and less reasoning (does not penalise the key).
 *  • CONCURRENCY `mapWithConcurrency` bounds parallel LLM work so batch jobs spread across keys without stampeding them.
 *
 * Health state is in-memory per server instance (serverless instances don't share it) — that is deliberate: it needs no extra infra and a
 * cold instance simply re-discovers a cooling key with one 429. Keys are never logged; only a short hash id is.
 */

export type Provider = "groq" | "gemini";
export type Tier = "rubric" | "batch" | "deep";

/* ─────────────────────────── configuration ─────────────────────────── */

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : d;
};

export const MODELS: Record<Provider, Record<Tier, string>> = {
  groq: {
    rubric: process.env.GROQ_MODEL_RUBRIC || "openai/gpt-oss-120b", // deep requirement extraction + critic pass
    batch: process.env.GROQ_MODEL_BATCH || "openai/gpt-oss-20b", // fast card scoring
    deep: process.env.GROQ_MODEL_DEEP || "openai/gpt-oss-120b", // single-profile / resume audit
  },
  gemini: {
    rubric: process.env.GEMINI_MODEL_RUBRIC || "gemini-2.5-flash",
    batch: process.env.GEMINI_MODEL_BATCH || "gemini-2.5-flash",
    deep: process.env.GEMINI_MODEL_DEEP || "gemini-2.5-flash", // set GEMINI_MODEL_DEEP=gemini-2.5-pro for maximum accuracy on paid quota
  },
};

const CFG = {
  maxAttempts: () => num(process.env.LLM_MAX_ATTEMPTS, 7),
  /** Total wall-clock budget for ONE structured call incl. failovers. Must stay under the route's maxDuration (60 s). */
  budgetMs: () => num(process.env.LLM_CALL_BUDGET_MS, 52_000),
  requestTimeoutMs: () => num(process.env.LLM_REQUEST_TIMEOUT_MS, 40_000),
  /** If every key is cooling but one frees up within this window, wait for it instead of failing. */
  maxWaitMs: () => num(process.env.LLM_MAX_WAIT_MS, 6_000),
  lowRequests: () => num(process.env.LLM_MIN_REMAINING_REQUESTS, 2),
  lowTokens: () => num(process.env.LLM_MIN_REMAINING_TOKENS, 3_000),
  providerOrder: (): Provider[] => {
    const o = (process.env.LLM_PROVIDER_ORDER || "groq,gemini")
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is Provider => s === "groq" || s === "gemini");
    return o.length ? [...new Set(o)] : ["groq", "gemini"];
  },
};

/* ─────────────────────────── key pools ─────────────────────────── */

const splitKeys = (v: string | undefined) =>
  (v ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

const uniq = (a: string[]) => [...new Set(a)];

/** Shared (server) keys for one provider, read fresh from env so tests / hot env changes work. */
export function sharedKeys(p: Provider): string[] {
  const P = p.toUpperCase();
  const out = [...splitKeys(process.env[`${P}_API_KEYS`]), ...splitKeys(process.env[`${P}_API_KEY`])];
  for (let i = 1; i <= 50; i++) out.push(...splitKeys(process.env[`${P}_API_KEY_${i}`]));
  return uniq(out);
}

export interface LlmContext {
  /** The HR's own keys. Tried before the shared pool. */
  groqKeys?: string[];
  geminiKeys?: string[];
  /** false → never fall back to the shared pool (HR chose to use only their own quota). Default true. */
  useShared?: boolean;
}
const als = new AsyncLocalStorage<LlmContext>();
export const runWithLlmContext = <T>(ctx: LlmContext, fn: () => Promise<T>): Promise<T> => als.run(ctx, fn);

interface KeyEntry {
  id: string; // stable, non-reversible: "groq:u:1a2b3c4d" (u = user key, s = shared key)
  provider: Provider;
  secret: string;
  own: boolean;
}

function poolFor(p: Provider): KeyEntry[] {
  const ctx = als.getStore();
  const mk = (secret: string, own: boolean): KeyEntry => ({ id: `${p}:${own ? "u" : "s"}:${sha1(secret).slice(0, 8)}`, provider: p, secret, own });
  const own = uniq((p === "groq" ? ctx?.groqKeys : ctx?.geminiKeys) ?? []).map((k) => mk(k, true));
  const shared = ctx?.useShared === false ? [] : sharedKeys(p).filter((k) => !own.some((o) => o.secret === k)).map((k) => mk(k, false));
  return [...own, ...shared];
}

export const hasAnyLlmKey = () => (["groq", "gemini"] as const).some((p) => poolFor(p).length > 0);

/* ─────────────────────────── health tracking ─────────────────────────── */

interface Health {
  hardUntil: number; // 429 / auth / server errors
  softUntil: number; // proactive: rate-limit headers say we are nearly out
  inflight: number;
  lastUsed: number;
  fails: number; // consecutive
  ok: number;
  remReq?: number;
  remTok?: number;
  lastError?: string;
}
const G = globalThis as unknown as { __llmHealth?: Map<string, Health>; __llmClients?: Map<string, Groq>; __gemSchemaMode?: { prompt: boolean } };
const health = (G.__llmHealth ??= new Map<string, Health>());
const groqClients = (G.__llmClients ??= new Map<string, Groq>());
const gemMode = (G.__gemSchemaMode ??= { prompt: false });

const H = (id: string): Health => {
  let h = health.get(id);
  if (!h) health.set(id, (h = { hardUntil: 0, softUntil: 0, inflight: 0, lastUsed: 0, fails: 0, ok: 0 }));
  return h;
};

function groqClient(secret: string): Groq {
  let c = groqClients.get(secret);
  if (!c) groqClients.set(secret, (c = new Groq({ apiKey: secret, maxRetries: 0 }))); // retries are the router's job
  return c;
}

/* ─────────────────────────── error classification ─────────────────────────── */

export class LlmError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: "rate" | "auth" | "server" | "json" | "bad" | "nokeys",
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

/** "1h2m3.5s", "2m59.56s", "7.66s", "250ms", "12" (seconds) → ms. */
export function parseDurationMs(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  let ms = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const n = parseFloat(m[1]);
    ms += m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.round(ms) : undefined;
}

type HeaderLike = { get(name: string): string | null } | Record<string, string | string[] | undefined> | null | undefined;
function hdr(h: HeaderLike, name: string): string | null {
  if (!h) return null;
  if (typeof (h as { get?: unknown }).get === "function") return (h as { get(n: string): string | null }).get(name);
  const v = (h as Record<string, string | string[] | undefined>)[name] ?? (h as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

const QUOTA_RE = /quota|rate.?limit|resource_exhausted|too many requests|tokens per (minute|day)|requests per (minute|day)|exceeded your current/i;
const JSON_RE = /json_validate_failed|Failed to (validate|generate) JSON|response_format|did not match|MAX_TOKENS/i;

interface Classified {
  kind: LlmError["kind"];
  status: number;
  message: string;
  cooldownMs?: number;
}

function classify(e: unknown, provider: Provider): Classified {
  const err = e as { status?: number; message?: string; name?: string; headers?: HeaderLike; retryAfterMs?: number; llmKind?: LlmError["kind"] };
  const status = err.status ?? 0;
  const message = (err.message ?? String(e)).slice(0, 400);
  if (err.llmKind) return { kind: err.llmKind, status: status || 502, message, cooldownMs: err.retryAfterMs };

  if (status === 429 || (status === 503 && QUOTA_RE.test(message)) || (status === 413 && /tokens/i.test(message)) || (status >= 400 && status < 500 && status !== 400 && QUOTA_RE.test(message))) {
    const ra = hdr(err.headers, "retry-after");
    const reset = parseDurationMs(hdr(err.headers, "x-ratelimit-reset-requests")) ?? parseDurationMs(hdr(err.headers, "x-ratelimit-reset-tokens"));
    const fromBody = err.retryAfterMs;
    const ms = (ra ? parseDurationMs(ra) : undefined) ?? fromBody ?? reset;
    return { kind: "rate", status: 429, message, cooldownMs: ms };
  }
  if (status === 401 || status === 403 || (provider === "gemini" && status === 400 && /api key (not valid|expired)|API_KEY_INVALID/i.test(message))) {
    return { kind: "auth", status: 401, message };
  }
  if (status === 400 && JSON_RE.test(message)) return { kind: "json", status: 400, message };
  if (err instanceof SyntaxError || err.name === "ZodError" || /Empty response|invalid JSON|not valid JSON/i.test(message)) return { kind: "json", status: 502, message };
  if (status >= 500 || status === 408 || err.name === "AbortError" || err.name === "TimeoutError" || /fetch failed|ECONN|ETIMEDOUT|socket|network|timed? ?out|Connection error/i.test(message)) {
    return { kind: "server", status: status || 503, message };
  }
  return { kind: "bad", status: status || 500, message };
}

function backoffMs(fails: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.min(fails, 6)) + Math.floor(Math.random() * 400);
}

function onSuccess(key: KeyEntry, remReq?: number, remTok?: number, resetReqMs?: number, resetTokMs?: number) {
  const h = H(key.id);
  h.fails = 0;
  h.ok++;
  h.lastError = undefined;
  h.remReq = remReq;
  h.remTok = remTok;
  // Proactive: park the key until its window resets instead of waiting for the 429.
  const lowReq = remReq !== undefined && remReq <= CFG.lowRequests();
  const lowTok = remTok !== undefined && remTok <= CFG.lowTokens();
  if (lowReq || lowTok) {
    const wait = Math.max(lowReq ? resetReqMs ?? 0 : 0, lowTok ? resetTokMs ?? 0 : 0) || 5_000;
    h.softUntil = Date.now() + Math.min(wait, 120_000);
  }
}

function onFailure(key: KeyEntry, c: Classified) {
  const h = H(key.id);
  h.fails++;
  h.lastError = `${c.kind}:${c.status}`;
  const now = Date.now();
  if (c.kind === "rate") h.hardUntil = now + Math.min(Math.max(c.cooldownMs ?? backoffMs(h.fails), 1_000), 15 * 60_000);
  else if (c.kind === "auth") h.hardUntil = now + 10 * 60_000;
  else if (c.kind === "server") h.hardUntil = now + Math.min(backoffMs(h.fails), 20_000);
}

/* ─────────────────────────── key selection ─────────────────────────── */

type Pick = { type: "key"; key: KeyEntry; soft: boolean } | { type: "wait"; ms: number } | { type: "none"; retryAfterMs?: number };

function pick(exclude: Set<string>, allowSoft: boolean): Pick {
  const now = Date.now();
  let soonest = Infinity;
  const softCandidates: KeyEntry[] = [];

  for (const provider of CFG.providerOrder()) {
    const pool = poolFor(provider).filter((k) => !exclude.has(k.id));
    const healthy: KeyEntry[] = [];
    for (const k of pool) {
      const h = H(k.id);
      if (h.hardUntil > now) soonest = Math.min(soonest, h.hardUntil - now);
      else if (h.softUntil > now) {
        softCandidates.push(k);
        soonest = Math.min(soonest, h.softUntil - now);
      } else healthy.push(k);
    }
    if (healthy.length) {
      // own keys first, then least in-flight, then least recently used
      healthy.sort((a, b) => Number(b.own) - Number(a.own) || H(a.id).inflight - H(b.id).inflight || H(a.id).lastUsed - H(b.id).lastUsed);
      return { type: "key", key: healthy[0], soft: false };
    }
  }
  // Every key is hard-cooling or nearly out of quota.
  if (allowSoft && softCandidates.length) {
    softCandidates.sort((a, b) => (H(b.id).remReq ?? 0) - (H(a.id).remReq ?? 0) || H(a.id).lastUsed - H(b.id).lastUsed);
    return { type: "key", key: softCandidates[0], soft: true };
  }
  if (soonest === Infinity) return { type: "none" };
  return soonest <= CFG.maxWaitMs() ? { type: "wait", ms: soonest + 50 } : { type: "none", retryAfterMs: soonest };
}

/* ─────────────────────────── provider calls ─────────────────────────── */

export interface ChatJsonArgs<T> {
  tier: Tier;
  /** Schema name (Groq strict mode requires one). */
  name: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  zod: ZodType<T, ZodTypeDef, unknown>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  temperature?: number;
}

interface CallState {
  maxTokens: number;
  effort: "low" | "medium" | "high";
}
const EFFORTS = ["low", "medium", "high"] as const;

async function callGroq<T>(key: KeyEntry, a: ChatJsonArgs<T>, s: CallState, timeout: number): Promise<T> {
  const req = {
    model: MODELS.groq[a.tier],
    temperature: a.temperature ?? 0,
    max_completion_tokens: s.maxTokens,
    reasoning_effort: s.effort,
    messages: [
      { role: "system", content: a.system },
      { role: "user", content: a.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: a.name, strict: true, schema: a.jsonSchema } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const { data, response } = await groqClient(key.secret).chat.completions.create(req, { timeout }).withResponse();
  const num = (n: string) => {
    const v = response.headers.get(n);
    return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  onSuccess(
    key,
    num("x-ratelimit-remaining-requests"),
    num("x-ratelimit-remaining-tokens"),
    parseDurationMs(response.headers.get("x-ratelimit-reset-requests")),
    parseDurationMs(response.headers.get("x-ratelimit-reset-tokens")),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const choice = (data as any).choices?.[0];
  const content = choice?.message?.content as string | undefined;
  if (!content) throw Object.assign(new Error("Empty response from Groq"), { llmKind: "json" as const });
  return a.zod.parse(parseJson(content));
}

const GEM_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini<T>(key: KeyEntry, a: ChatJsonArgs<T>, s: CallState, timeout: number): Promise<T> {
  const model = MODELS.gemini[a.tier];
  const thinking = /^gemini-2\.5/.test(model) ? { thinkingBudget: s.effort === "low" ? 512 : s.effort === "medium" ? 1536 : 4096 } : undefined;
  const asPrompt = gemMode.prompt;
  const body = {
    systemInstruction: { parts: [{ text: asPrompt ? `${a.system}\n\nReturn ONLY JSON matching this JSON Schema:\n${JSON.stringify(a.jsonSchema)}` : a.system }] },
    contents: [{ role: "user", parts: [{ text: a.user }] }],
    generationConfig: {
      temperature: a.temperature ?? 0,
      maxOutputTokens: s.maxTokens + (thinking?.thinkingBudget ?? 0),
      responseMimeType: "application/json",
      ...(asPrompt ? {} : { responseJsonSchema: a.jsonSchema }),
      ...(thinking ? { thinkingConfig: thinking } : {}),
    },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res: Response;
  try {
    res = await fetch(`${GEM_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key.secret },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const raw = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (!res.ok) {
    const msg = raw.error?.message ?? `Gemini request failed (${res.status})`;
    // Schema keyword the endpoint doesn't accept → remember and retry as a prompt-embedded schema (no key penalty).
    if (res.status === 400 && !asPrompt && /responseJsonSchema|response_json_schema|schema|Unknown name/i.test(msg) && !/API key/i.test(msg)) {
      gemMode.prompt = true;
      throw Object.assign(new Error(msg), { llmKind: "json" as const, status: 400 });
    }
    const retryDelay = raw.error?.details?.map((d) => d.retryDelay).find(Boolean);
    throw Object.assign(new Error(raw.error?.status ? `${raw.error.status}: ${msg}` : msg), {
      status: res.status,
      headers: res.headers,
      retryAfterMs: parseDurationMs(retryDelay),
    });
  }
  onSuccess(key); // Gemini exposes no rate-limit headers; 429s drive its cooldowns
  const cand = raw.candidates?.[0];
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (raw.promptFeedback?.blockReason && !text) throw Object.assign(new Error(`Gemini blocked the prompt (${raw.promptFeedback.blockReason})`), { status: 400 });
  if (!text) throw Object.assign(new Error(cand?.finishReason === "MAX_TOKENS" ? "MAX_TOKENS: output truncated" : "Empty response from Gemini"), { llmKind: "json" as const });
  if (cand?.finishReason === "MAX_TOKENS") throw Object.assign(new Error("MAX_TOKENS: output truncated"), { llmKind: "json" as const });
  return a.zod.parse(parseJson(text));
}

/** Tolerates ```json fences and leading/trailing prose. */
function parseJson(s: string): unknown {
  const t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch (e) {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw e;
  }
}

/* ─────────────────────────── public: structured call ─────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One structured-JSON completion with rotation, cooldowns, proactive switching and Groq⇄Gemini failover.
 * Throws LlmError (status 429 when every key is rate-limited — `retryAfterSec` says when to try again).
 */
export async function chatJson<T>(a: ChatJsonArgs<T>): Promise<T> {
  if (!hasAnyLlmKey()) throw new LlmError("No LLM API key configured. Set GROQ_API_KEYS / GEMINI_API_KEYS on the server or add your own keys in Settings.", 503, "nokeys");

  const deadline = Date.now() + CFG.budgetMs();
  const state: CallState = { maxTokens: a.maxTokens, effort: a.effort };
  const skip = new Set<string>(); // keys that returned a non-retryable error for THIS call
  const jsonFails = new Map<string, number>();
  let attempts = 0;
  let last: Classified | null = null;
  let retryAfterMs: number | undefined;

  while (attempts < CFG.maxAttempts() && Date.now() < deadline) {
    const p = pick(skip, true);
    if (p.type === "wait") {
      await sleep(Math.min(p.ms, Math.max(0, deadline - Date.now())));
      continue;
    }
    if (p.type === "none") {
      retryAfterMs = p.retryAfterMs;
      break;
    }
    const key = p.key;
    const h = H(key.id);
    attempts++;
    h.inflight++;
    h.lastUsed = Date.now();
    try {
      const timeout = Math.max(5_000, Math.min(CFG.requestTimeoutMs(), deadline - Date.now()));
      return key.provider === "groq" ? await callGroq(key, a, state, timeout) : await callGemini(key, a, state, timeout);
    } catch (e) {
      const c = classify(e, key.provider);
      last = c;
      if (c.kind === "json") {
        // Output ran out of room / wasn't valid JSON: give the answer more tokens, the reasoning less. Not the key's fault.
        state.maxTokens = Math.min(16_000, Math.round(state.maxTokens * 1.7));
        state.effort = EFFORTS[Math.max(0, EFFORTS.indexOf(state.effort) - 1)];
        const n = (jsonFails.get(key.id) ?? 0) + 1;
        jsonFails.set(key.id, n);
        if (n >= 2) skip.add(key.id); // let another key / provider try
      } else if (c.kind === "bad") {
        skip.add(key.id);
      } else {
        onFailure(key, c);
        if (c.kind === "rate") retryAfterMs = Math.max(retryAfterMs ?? 0, c.cooldownMs ?? 0) || undefined;
      }
      if (process.env.LLM_DEBUG) console.warn(`[llm] ${key.id} ${c.kind} ${c.status}: ${c.message.slice(0, 160)}`);
    } finally {
      h.inflight--;
    }
  }

  if (last && last.kind !== "rate" && last.kind !== "nokeys") throw new LlmError(last.message, last.kind === "auth" ? 502 : last.status >= 400 ? last.status : 502, last.kind);
  const wait = retryAfterMs ?? soonestCooldownMs();
  throw new LlmError(
    `All AI keys are rate-limited right now${wait ? ` — retry in ~${Math.ceil(wait / 1000)}s` : ""}. Add more keys (GROQ_API_KEYS / GEMINI_API_KEYS) or your own key in Settings.`,
    429,
    "rate",
    wait ? Math.ceil(wait / 1000) : undefined,
  );
}

function soonestCooldownMs(): number | undefined {
  const now = Date.now();
  let m = Infinity;
  for (const p of CFG.providerOrder())
    for (const k of poolFor(p)) {
      const h = H(k.id);
      const until = Math.max(h.hardUntil, h.softUntil);
      if (until > now) m = Math.min(m, until - now);
    }
  return m === Infinity ? undefined : m;
}

/* ─────────────────────────── bounded concurrency ─────────────────────────── */

export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Runs `fn` over `items` with at most `limit` in flight. Order-preserving; never rejects (each slot is ok/error), so one bad
 * resume or card can't sink the whole batch.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<Settled<R>[]> {
  const out: Settled<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Default parallelism for batch LLM work: ~2 calls per available key, capped (LLM_CONCURRENCY overrides). */
export function defaultConcurrency(): number {
  const forced = num(process.env.LLM_CONCURRENCY, 0);
  if (forced > 0) return forced;
  const keys = poolFor("groq").length + poolFor("gemini").length;
  return Math.max(2, Math.min(6, keys * 2));
}

/* ─────────────────────────── diagnostics ─────────────────────────── */

/** Redacted pool status for the Settings page / debugging (no secrets: ids are short hashes). */
export function llmStatus() {
  const now = Date.now();
  return (["groq", "gemini"] as const).map((p) => {
    const pool = poolFor(p);
    const keys = pool.map((k) => {
      const h = H(k.id);
      return {
        id: k.id,
        own: k.own,
        state: h.hardUntil > now ? "cooling" : h.softUntil > now ? "near-limit" : "healthy",
        cooldownSec: Math.max(0, Math.ceil((Math.max(h.hardUntil, h.softUntil) - now) / 1000)),
        remainingRequests: h.remReq ?? null,
        remainingTokens: h.remTok ?? null,
        ok: h.ok,
        lastError: h.lastError ?? null,
      };
    });
    return { provider: p, models: MODELS[p], keys };
  });
}
