import { start, stats } from "./mockgroq.mjs";
import fs from "node:fs";
const BASE = "http://localhost:3100";
await start(4010);
let pass = 0, fail = 0;
const ok = (c, m, extra) => { c ? pass++ : (fail++, console.log("FAIL:", m, extra ?? "")); if (c) console.log("ok  :", m); };

class Client {
  constructor() { this.cookie = ""; }
  async req(path, { method = "GET", json, form, headers = {}, raw } = {}) {
    const h = { ...headers, ...(this.cookie ? { cookie: this.cookie } : {}) };
    let body;
    if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
    if (form) body = form;
    const r = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
    const sc = r.headers.getSetCookie?.() ?? [];
    for (const c of sc) { const [kv] = c.split(";"); if (kv.endsWith("=") ) this.cookie = ""; else this.cookie = kv; }
    if (raw) return r;
    const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
    return { status: r.status, data: d, headers: r.headers };
  }
}
const ext = (key) => (path, o = {}) => fetch(BASE + "/api/extension" + path, { method: o.method ?? (o.json ? "POST" : "GET"), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: o.json ? JSON.stringify(o.json) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

const A = new Client(), B = new Client(), anon = new Client();
// 1. gate
let r = await anon.req("/api/resumes"); ok(r.status === 401, "anonymous API call → 401");
r = await anon.req("/jobs", { raw: true }); ok(r.status === 307 || r.status === 302, `anonymous page → redirect (${r.status}) to ${r.headers.get("location")}`);
// 2. signup (open via ALLOW_SIGNUP)
r = await A.req("/api/auth/signup", { method: "POST", json: { email: "a@hr.test", name: "HR A", password: "password123" } }); ok(r.status === 201 && A.cookie.startsWith("xs_session="), "HR A signs up and gets a session cookie", r.data);
r = await B.req("/api/auth/signup", { method: "POST", json: { email: "b@hr.test", name: "HR B", password: "password456" } }); ok(r.status === 201, "HR B signs up");
r = await anon.req("/api/auth/login", { method: "POST", json: { email: "a@hr.test", password: "wrong-password1" } }); ok(r.status === 401, "wrong password → 401");
r = await anon.req("/api/auth/signup", { method: "POST", json: { email: "a@hr.test", name: "x", password: "password123" } }); ok(r.status === 409, "duplicate email → 409");
r = await A.req("/jobs", { raw: true }); ok(r.status === 200, "logged-in page renders");

// 3. job per HR
r = await A.req("/api/jobs", { method: "POST", json: { rawDescription: "Senior Java Developer needed. Must have Java, Spring Boot, Kubernetes, Kafka. 5-9 years. Bangalore. Notice 30 days." } });
ok(r.status === 201 && r.data.job?.id, "HR A creates a job (rubric via mock LLM)", r.data); const jobA = r.data.job.id;
r = await B.req(`/api/jobs/${jobA}`, { method: "PATCH", json: { title: "hijack" } }); ok(r.status === 404, "HR B cannot edit HR A's job");
r = await B.req(`/api/jobs/${jobA}`, { method: "DELETE" }); ok(r.status === 404, "HR B cannot delete HR A's job");
r = await B.req(`/jobs/${jobA}`, { raw: true }); ok(r.status === 404, "HR B cannot open HR A's job page");

// 4. extension login → per-HR key
let l = await fetch(BASE + "/api/extension/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@hr.test", password: "password123" }) }).then((x) => x.json());
ok(l.apiKey?.startsWith("rsx_") && l.user.email === "a@hr.test", "extension login returns HR A's key");
const keyA = l.apiKey; const eA = ext(keyA);
l = await fetch(BASE + "/api/extension/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "b@hr.test", password: "password456" }) }).then((x) => x.json());
const eB = ext(l.apiKey);
let x = await eA("/jobs"); ok(x.data.jobs.length === 1, "ext: HR A sees 1 job");
x = await eB("/jobs"); ok(x.data.jobs.length === 0, "ext: HR B sees 0 jobs (isolation)");
x = await eB("/score-batch", { json: { jobId: jobA, candidates: [{ domId: "c1", rawText: "Java dev" }] } }); ok(x.status === 404, "ext: HR B cannot score against HR A's job");
x = await eB(`/analyzed?jobId=${jobA}`); ok(x.status === 404, "ext: HR B cannot read HR A's analyzed list");
x = await fetch(BASE + "/api/extension/jobs", { headers: { authorization: "Bearer rsx_bogus" } }); ok(x.status === 401, "ext: bad key → 401");

// 5. cache
const cards = [
  { domId: "ai-1", rawText: "Priya Nair\nSenior Java Developer at Acme\n6 Yrs 3 Months | 20 Lacs | Notice: 30 days\nBengaluru\nKey skills: Java, Spring Boot, Kubernetes, Kafka\nCurrent: Senior Java Developer", profileUrl: "https://resdex.naukri.com/profile/111?src=a" },
  { domId: "ai-2", rawText: "Vikram Shah\nJava Lead at Globex\n8 Yrs | 30 Lacs | Notice: 60 days\nPune\nKey skills: Java, Microservices, AWS\nCurrent: Java Lead" },
  { domId: "ai-3", rawText: "Meera Iyer\nGraphic Designer at Studio\n4 Yrs | 8 Lacs | Notice: 15 days\nChennai\nKey skills: Photoshop, Figma\nCurrent: Designer" },
];
const s1 = await eA("/search-session", { json: { jobId: jobA, signature: "sig-1", state: { keywords: "java kubernetes", location: "Bengaluru", minExp: 5, maxExp: 9, filters: [{ label: "Notice", value: "30 days" }] } } });
ok(s1.status === 200 && s1.data.session.id, "search session created", s1.data); const ss1 = s1.data.session.id;
const s1b = await eA("/search-session", { json: { jobId: jobA, signature: "sig-1", state: { keywords: "java kubernetes" } } }); ok(s1b.data.session.id === ss1, "same signature → same search session");
const s2 = await eA("/search-session", { json: { jobId: jobA, signature: "sig-2", state: { keywords: "java" } } }); const ss2 = s2.data.session.id; ok(ss2 !== ss1, "changed filters → new search session");

let before = stats.calls;
x = await eA("/score-batch", { json: { jobId: jobA, candidates: cards, searchSessionId: ss1 } });
ok(x.status === 200 && x.data.results.length === 3 && x.data.stats.scored === 3, "first scoring: 3 scored", x.data.error);
ok(stats.calls - before === 1, `3 cards = 1 LLM call (${stats.calls - before})`);
const byId = Object.fromEntries(x.data.results.map((q) => [q.domId, q]));
ok(byId["ai-1"].score > byId["ai-3"].score && byId["ai-1"].key.startsWith("u:") && byId["ai-2"].key.startsWith("t:"), `scores sensible & keys: ${byId["ai-1"].score}/${byId["ai-2"].score}/${byId["ai-3"].score}`);
ok(byId["ai-1"].extracted && byId["ai-1"].confidence, "result carries facts + confidence");
before = stats.calls;
x = await eA("/score-batch", { json: { jobId: jobA, candidates: cards, searchSessionId: ss1 } });
ok(x.data.stats.cached === 3 && stats.calls === before, "second scoring: all 3 from cache, ZERO LLM calls");
const changed = cards.map((c, i) => (i === 1 ? { ...c, rawText: c.rawText + "\nNow Notice: 15 days" } : { ...c, domId: c.domId + "x" }));
x = await eA("/score-batch", { json: { jobId: jobA, candidates: changed, searchSessionId: ss1 } });
ok(x.data.stats.cached === 2 && x.data.stats.scored === 1 && stats.calls === before + 1, `changed card re-scored only (cached ${x.data.stats.cached}, scored ${x.data.stats.scored})`);
// only cached
before = stats.calls;
x = await eA("/score-batch", { json: { jobId: jobA, candidates: [...cards.slice(0, 1), { domId: "new-1", rawText: "Someone New\nJava Dev\n5 Yrs | 15 Lacs | Notice 30 days\nBengaluru Key skills Java" }], onlyCached: true } });
ok(x.data.results.length === 1 && x.data.unscored.join() === "new-1" && stats.calls === before, "onlyCached: cached returned, new card left unscored, no LLM call");

// 6. analyzed lists per search
x = await eA(`/analyzed?jobId=${jobA}&searchSessionId=${ss1}`); ok(x.data.items.length >= 3, `analyzed (search 1): ${x.data.items.length}`);
x = await eA(`/analyzed?jobId=${jobA}&searchSessionId=${ss2}`); ok(x.data.items.length === 0, "analyzed (search 2, nothing seen): 0");
x = await eA(`/analyzed?jobId=${jobA}`); ok(x.data.items.length >= 3 && x.data.items[0].score >= x.data.items.at(-1).score, "analyzed (whole job) sorted by score");
x = await eA(`/analyzed?jobId=${jobA}&minScore=90`); ok(x.data.items.every((i) => i.score >= 90), "minScore filter");

// 7. résumés (library, independent of the extension)
const pdf = fs.readFileSync(new URL("./asha.pdf", import.meta.url)), docx = fs.readFileSync(new URL("./ravi.docx", import.meta.url));
let fd = new FormData(); fd.append("file", new File([pdf], "asha.pdf", { type: "application/pdf" }));
r = await A.req("/api/resumes", { method: "POST", form: fd });
ok(r.status === 200 && r.data.results[0].ok && !r.data.results[0].error, "store-only PDF upload (no LLM)", JSON.stringify(r.data)); const rid = r.data.results[0].resume.id;
ok(r.data.results[0].resume.hasText && r.data.results[0].resume.guessedName === "Asha Rao", `text extracted, name guessed: ${r.data.results[0].resume.guessedName}`);
fd = new FormData(); fd.append("file", new File([pdf], "asha-copy.pdf", { type: "application/pdf" })); r = await A.req("/api/resumes", { method: "POST", form: fd });
ok(r.data.results[0].duplicate === true, "same bytes uploaded again → deduplicated");
let f = await A.req(`/api/resumes/${rid}?inline=1`, { raw: true }); const buf = Buffer.from(await f.arrayBuffer());
ok(f.status === 200 && f.headers.get("content-type") === "application/pdf" && /^inline/.test(f.headers.get("content-disposition")) && buf.equals(pdf), "view inline: identical PDF bytes");
f = await A.req(`/api/resumes/${rid}`, { raw: true }); ok(/^attachment/.test(f.headers.get("content-disposition")), "download → attachment");
f = await B.req(`/api/resumes/${rid}?inline=1`, { raw: true }); ok(f.status === 404, "HR B cannot view HR A's resume");
r = await B.req("/api/resumes"); ok(r.data.resumes.length === 0, "HR B's library is empty");
r = await A.req(`/api/resumes/${rid}/text`); ok(r.data.text.includes("Kubernetes"), "text endpoint returns extracted text");
before = stats.calls;
r = await A.req(`/api/resumes/${rid}/score`, { method: "POST", json: { jobId: jobA } }); ok(r.status === 200 && r.data.candidate.aiScore > 0 && r.data.cached === false && stats.calls === before + 1, `score stored résumé → ${r.data.candidate?.aiScore}%`, r.data);
r = await A.req(`/api/resumes/${rid}/score`, { method: "POST", json: { jobId: jobA } }); ok(r.data.cached === true && stats.calls === before + 1, "re-score same résumé+rubric → cached, no LLM");
ok(r.data.candidate.resume?.id === rid, "candidate DTO links the stored résumé");
r = await B.req(`/api/resumes/${rid}/score`, { method: "POST", json: { jobId: jobA } }); ok(r.status === 404, "HR B cannot score HR A's résumé");
fd = new FormData(); fd.append("file", new File([docx], "ravi.docx")); r = await A.req(`/api/jobs/${jobA}/candidates/upload`, { method: "POST", form: fd });
ok(r.status === 200 && r.data.results[0].ok && r.data.results[0].candidate, "job upload: DOCX stored + scored", JSON.stringify(r.data).slice(0, 300)); const candId = r.data.results[0].candidate.id;
f = await A.req(`/api/candidates/${candId}/resume`, { raw: true }); ok(f.status === 200 && /wordprocessingml/.test(f.headers.get("content-type")), "candidate résumé download (DOCX)");
f = await B.req(`/api/candidates/${candId}/resume`, { raw: true }); ok(f.status === 404, "HR B cannot download HR A's candidate résumé");
r = await A.req("/api/resumes?q=Kumar"); ok(r.data.resumes.length === 1, "library text search finds the DOCX by content/name");
f = await A.req(`/jobs/${jobA}`, { raw: true }); const html = await f.text(); ok(f.status === 200 && html.includes("Resume library") && html.includes("asha"), "job page lists résumés");
f = await A.req(`/candidates`, { raw: true }); ok((await f.text()).includes("Resume library"), "candidates page has the résumé library");

// 8. rubric edit invalidates cache
r = await A.req(`/api/jobs/${jobA}`); // (GET not defined → 405) just to refresh cookies
const jobPage = await (await A.req(`/api/extension/jobs`, { raw: true })).status;
x = await eA("/jobs"); const rub = x.data.jobs[0].rubric;
r = await A.req(`/api/jobs/${jobA}`, { method: "PATCH", json: { rubric: { ...rub, mustHaveSkills: ["Java", "Kubernetes", "Terraform"] } } }); ok(r.status === 200, "rubric edited");
before = stats.calls;
x = await eA("/score-batch", { json: { jobId: jobA, candidates: cards } }); ok(x.data.stats.cached === 0 && stats.calls === before + 1, "rubric change → cache miss, re-scored under the new rubric");
x = await eA(`/analyzed?jobId=${jobA}`); ok(x.data.items.length === 3 && x.data.staleCount > 0, `analyzed uses the new rubric only (stale rows from old rubric: ${x.data.staleCount})`);

// 9. own keys
r = await A.req("/api/settings/llm-keys", { method: "PUT", json: { groq: ["gsk_ownkeyownkeyownkey1234567890"] } }); ok(r.status === 200 && r.data.groq[0] === "…7890", "own key saved, only last 4 shown", r.data);
r = await A.req("/api/settings/llm-keys", { method: "PUT", json: { groq: ["not-a-key"] } }); ok(r.status === 400, "invalid key format rejected");
r = await B.req("/api/settings/llm-keys"); ok(r.data.groq.length === 0, "HR B has no keys (isolated)");
r = await A.req("/api/settings/llm-keys", { method: "PUT", json: { useShared: false } }); ok(r.data.useShared === false, "own-keys-only toggle");
x = await eA("/me"); ok(x.data.llm.ownGroqKeys === 1 && x.data.llm.useShared === false, "ext /me reports key settings");
console.log(`\n${pass} passed, ${fail} failed; LLM calls by schema:`, stats.byName);
process.exit(fail ? 1 : 0);
