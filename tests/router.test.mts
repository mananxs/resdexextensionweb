import { z } from "zod";
process.env.GROQ_API_KEYS = "gsk_AAAAAAAAAAAAAAAAAAAA1111, gsk_BBBBBBBBBBBBBBBBBBBB2222";
process.env.GROQ_API_KEY_3 = "gsk_CCCCCCCCCCCCCCCCCCCC3333";
process.env.GEMINI_API_KEYS = "AIzaGEMINIKEYGEMINIKEYGEMINIKEY00001";
process.env.LLM_MAX_WAIT_MS = "0";
const R = await import("../src/lib/llmRouter.ts");

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); if (c) console.log("ok  :", m); };

console.log("shared groq keys:", R.sharedKeys("groq").length, "gemini:", R.sharedKeys("gemini").length);
ok(R.sharedKeys("groq").length === 3 && R.sharedKeys("gemini").length === 1, "env parsing: GROQ_API_KEYS + GROQ_API_KEY_N, GEMINI_API_KEYS");
ok(R.parseDurationMs("2m59.56s") === 179560 && R.parseDurationMs("250ms") === 250 && R.parseDurationMs("7.66s") === 7660 && R.parseDurationMs("30") === 30000, "duration parsing");

const calls: string[] = [];
let mode: Record<string, "429" | "ok" | "lowtok" | "500"> = {};
const body = JSON.stringify({ ok: true });
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const h = new Headers(init?.headers as HeadersInit);
  if (u.includes("generativelanguage")) {
    calls.push("gemini");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: body }] }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const key = (h.get("authorization") ?? "").slice(-4);
  calls.push("groq:" + key);
  const m = mode[key] ?? "ok";
  if (m === "429") return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } });
  if (m === "500") return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500, headers: { "content-type": "application/json" } });
  const headers: Record<string, string> = { "content-type": "application/json", "x-ratelimit-remaining-requests": "50", "x-ratelimit-remaining-tokens": m === "lowtok" ? "100" : "9000", "x-ratelimit-reset-tokens": "20s" };
  return new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), { status: 200, headers });
}) as typeof fetch;

const args = { tier: "batch" as const, name: "t", system: "s", user: "u", jsonSchema: { type: "object" }, zod: z.object({ ok: z.boolean() }), maxTokens: 100, effort: "low" as const };

// 1. rotation across healthy keys
calls.length = 0;
for (let i = 0; i < 3; i++) await R.chatJson(args);
ok(new Set(calls).size === 3, `rotates across 3 groq keys: ${calls.join(",")}`);

// 2. 429 on key 1111 → cooled down, next call goes elsewhere, never back within cooldown
mode = { "1111": "429", "2222": "429" };
calls.length = 0;
for (let i = 0; i < 3; i++) await R.chatJson(args);
ok(calls.filter((c) => c === "groq:1111").length <= 1 && calls.filter((c) => c === "groq:2222").length <= 1, `429 keys are put on cooldown (hit at most once each): ${calls.join(",")}`);
ok(calls.filter((c) => c === "groq:3333").length >= 3, "traffic moved to the healthy key");

// 3. proactive: key 3333 reports 100 tokens left → parked BEFORE any 429, and with the other two cooling it fails over to Gemini
mode = { "1111": "429", "2222": "429", "3333": "lowtok" };
calls.length = 0;
await R.chatJson(args); // 3333 answers but reports low tokens → soft-parked
await R.chatJson(args); // all groq cooling/parked → gemini
await R.chatJson(args);
ok(calls[0] === "groq:3333" && calls.slice(1).every((c) => c === "gemini"), `low x-ratelimit-remaining-tokens parks the key and fails over to Gemini: ${calls.join(",")}`);
const st = R.llmStatus();
ok(st[0].keys.find((k: any) => k.id.endsWith("") && k.state === "near-limit") !== undefined, "status shows near-limit key");

// 4. per-request user keys are tried first
calls.length = 0;
mode = {};
await R.runWithLlmContext({ groqKeys: ["gsk_USERUSERUSERUSERUSER9999"], useShared: true }, () => R.chatJson(args));
ok(calls[0] === "groq:9999", `own key first: ${calls[0]}`);
// own key only → shared never used
calls.length = 0;
mode = { "9999": "429" };
let threw = false;
try { await R.runWithLlmContext({ groqKeys: ["gsk_USERUSERUSERUSERUSER9999"], useShared: false }, () => R.chatJson(args)); } catch (e: any) { threw = e.status === 429; }
ok(threw && calls.every((c) => c === "groq:9999"), `useShared:false never touches the shared pool, surfaces 429 (${calls.join(",")})`);

// 5. all providers exhausted → LlmError 429 with retryAfter
mode = { "1111": "429", "2222": "429", "3333": "429" };
// gemini → 429 too
const f0 = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => String(url).includes("generativelanguage") ? new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "quota", details: [{ retryDelay: "17s" }] } }), { status: 429, headers: { "content-type": "application/json" } }) : f0(url, init)) as typeof fetch;
let err: any;
try { await R.chatJson(args); } catch (e) { err = e; }
ok(err?.status === 429 && err.retryAfterSec > 0, `all exhausted → 429 + retryAfter=${err?.retryAfterSec}s`);

// 6. mapWithConcurrency: bounded + order preserved + errors isolated
let cur = 0, max = 0;
const res = await R.mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n: number) => { cur++; max = Math.max(max, cur); await new Promise((r) => setTimeout(r, 10)); cur--; if (n === 4) throw new Error("x"); return n * 2; });
ok(max <= 3 && res[0].ok && (res[0] as any).value === 2 && !res[3].ok && (res[6] as any).value === 14, `mapWithConcurrency bounded (max in flight ${max}) and isolates failures`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
