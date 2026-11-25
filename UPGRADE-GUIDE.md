# XS-NaukriAI — multi-HR upgrade guide

Two projects changed: `resdexextensionweb-main` (Next.js + Prisma) and `extension` (Vite + React MV3).
Everything below was type-checked, built and run (see "What was verified" at the end).

---

## 1. Deploy — in this order

### 1.1 Database (Neon) — additive only, no data is dropped
Pick one:
```bash
cd resdexextensionweb-main
# A) from your machine, using the DIRECT (non-pooler) Neon URL
DATABASE_URL="<neon pooled url>" DIRECT_URL="<neon direct url>" npx prisma db push
# B) or paste prisma/upgrade-multi-hr.sql into the Neon SQL editor (same changes, reviewed SQL)
```
Adds: `User.passwordHash / groqKeysEnc / geminiKeysEnc / useSharedKeys`, `Job.rubricHash`, `Candidate.scoredRubricHash`,
and the new tables `Session`, `Resume`, `ScoreCache`, `SearchSession`, `SearchHit`. Existing columns (incl. the old inline résumé bytes) are untouched.

### 1.2 Vercel environment variables (Project → Settings → Environment Variables, Production **and** Preview)
| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** URL (host has `-pooler`) |
| `DIRECT_URL` | yes | Neon direct URL (used by `prisma db push/migrate`) |
| `SESSION_SECRET` | yes | `openssl rand -base64 32` |
| `APP_ENCRYPTION_KEY` | recommended | `openssl rand -base64 32`; encrypts HRs' personal API keys (falls back to `SESSION_SECRET`). Changing it makes saved personal keys unreadable — HRs re-enter them |
| `SIGNUP_INVITE_CODE` | **set this before the first deploy** | Required on `/signup`. Without it (and without `ALLOW_SIGNUP=true`) only the very first account on an empty DB can sign up |
| `ALLOW_SIGNUP` | optional | `true` = open sign-up (not recommended on a public URL) |
| `LEGACY_CLAIM_EMAIL` | upgrading only | Set to your old `DEFAULT_USER_EMAIL`, then sign up once with that email: it adopts the existing jobs/candidates and sets a password |
| `GROQ_API_KEYS` | one of Groq/Gemini | comma- or newline-separated. Also read: `GROQ_API_KEY`, `GROQ_API_KEY_1…50` |
| `GEMINI_API_KEYS` | one of Groq/Gemini | same forms: `GEMINI_API_KEY`, `GEMINI_API_KEY_1…50` |
| `LLM_PROVIDER_ORDER` | optional | default `groq,gemini` (next provider is used when all keys of the first are cooling/failing) |
| `GROQ_MODEL_*`, `GEMINI_MODEL_*`, `LLM_CONCURRENCY`, `LLM_BATCH_CHUNK`, `LLM_MIN_REMAINING_REQUESTS`, `LLM_MIN_REMAINING_TOKENS`, `LLM_MAX_WAIT_MS`, `LLM_CALL_BUDGET_MS`, `RESUME_LLM_MAX_CHARS` | optional | defaults are in `.env.example` |

`DEFAULT_USER_EMAIL` / `DEFAULT_USER_NAME` are no longer used (there is no shared user). Env changes need a redeploy.
Build settings stay default: install `npm install`, build `npm run build` (= `prisma generate && next build`).

Vercel limits that shaped the design: request bodies ≤ ~4.5 MB → résumés are capped at **4 MB** and uploaded **one file per request**;
the scoring routes use `maxDuration = 60`.

### 1.3 Extension — rebuild `extension/dist/`
```bash
cd extension
npm ci
npm run typecheck
npm run build        # = vite build && vite build --config vite.content.config.ts  → dist/
```
Then `chrome://extensions` → Developer mode → **Load unpacked → `extension/dist`** (or press **Reload** if already loaded; the manifest gained the `webNavigation` permission, so Chrome re-asks once).
Load `extension/dist`, **not** `extension/` — the loose `content.js`, `service-worker.js`, `sidepanel.*`, `assets/`, `manifest.json` at the root of `extension/` are an old leftover build that no config produces; they were left untouched.

In the side panel: Platform URL + the HR's **email & password** (same account as the web app). "Paste API key" still works.

---

## 2. What changed, by requirement

### 2.1 Multi-key / multi-provider LLM pool + accuracy
| File | Change |
|---|---|
| `src/lib/llmRouter.ts` (new) | Key pools from env + per-HR keys (AsyncLocalStorage context, own keys first, `useShared:false` never touches the pool); least-loaded rotation; cooldown on 429/quota (`retry-after` / Gemini `retryDelay` / exponential backoff), 10-min park on 401/403, short backoff on 5xx; **proactive parking** when `x-ratelimit-remaining-requests/-tokens` fall under thresholds (until `x-ratelimit-reset-*`); Groq⇄Gemini failover; JSON-repair retries (more tokens, less reasoning, no key penalty); `mapWithConcurrency`, `defaultConcurrency`, `llmStatus` |
| `src/lib/groq.ts` | Prompts/post-processing only now (transport is the router). Stricter rubric (evidence-first, lower level when torn, anti keyword-stuffing, experience derivation), separate card/deep level scales, **chunked parallel card scoring** (`LLM_BATCH_CHUNK`, default 10) with split-and-retry, regex recovery of experience/notice the model left blank, `gaps` + score `breakdown` in the audit |
| `src/lib/textClean.ts` (new) | Unicode/zero-width/page-furniture/header-footer/de-hyphenation clean-up; résumé trimming that drops declaration/hobbies/references first and otherwise keeps head + tail (not a blind cut); JD boilerplate removal. Contact details are scraped from the **untrimmed** text |
| `src/lib/evidenceGuard.ts` (new) | Anti-hallucination: a tech skill rated present but never mentioned (nor implied, e.g. Spring Boot⇒Java, EKS⇒Kubernetes) is capped at partial; "level 2" with "No evidence" is demoted; a deal-breaker (which caps the score at 30) needs a quote |
| `src/lib/scoring.ts` | Score stays deterministic; now also returns `breakdown` (weighted raw score, coverage per tier, which caps fired, confidence) |
| `src/lib/keys.ts`, `scoreCache.ts` (new), `prisma ScoreCache` | Cache key **(userId, jobId, candidateKey, rubricHash, kind)** + `contentHash`. Same candidate + same text + same rubric ⇒ no LLM call; text changed ⇒ re-scored; rubric edited ⇒ `rubricHash` changes ⇒ old rows stop matching. `rubricHash` covers requirements/limits/aliases only (not the Resdex query), and `SCORING_VERSION` invalidates everything when prompts change |
| `api/extension/score-batch`, `score-profile`, `import-candidate`, `resumes/[id]/score`, `jobs/[id]/candidates/upload` | All go through the cache; responses say `cached`/`stats` |

### 2.2 Résumés independent of the extension
| File | Change |
|---|---|
| `prisma` model `Resume` | file metadata, sha-256 (de-dupe per HR), extracted text, guessed name, bytes in Postgres (`bytea`) — durable on Vercel, covered by Neon backups; may be linked to a job and/or a candidate, or stand alone |
| `src/lib/resumes.ts`, `resumeResponse.ts` | store/validate (PDF/DOCX, ≤ 4 MB, MIME derived from extension), ownership-checked streaming; only PDFs render inline, everything else is attachment + `nosniff` |
| `api/resumes` (GET list/search, POST store-only), `api/resumes/[id]` (view `?inline=1` / download / DELETE), `[id]/text`, `[id]/score` | |
| `api/jobs/[id]/candidates/upload` | file is **always stored first** (viewable even if scoring fails or is skipped with `score=0`), then scored in parallel |
| `components/ResumeLibrary.tsx` (new) on `/candidates` and `/jobs/[id]` | upload, View (PDF in a tab; DOCX as extracted text), Download, Delete, "Score against job" |
| `CandidateBoard.tsx`, `candidates/page.tsx` | View/Download straight from the candidate; legacy inline résumés still served |

### 2.3 Naukri search & filter sync + "Analyzed only"
| File | Change |
|---|---|
| `src/content/searchState.ts` (new) | Reads keyword boxes **and chips** (all / any / exclude), location, min/max experience, min/max salary, every selected filter (checkbox, radio, `aria-checked/pressed/selected`, non-default `<select>`) grouped under its heading, plus URL params. Result-card checkboxes are excluded |
| `src/content/formFields.ts` (new) | field helpers shared by Fill and the reader (moved out of the observer unchanged) |
| `src/content/resdex-observer.ts` | Re-reads on input/change/keyup/click/Enter, aria/class toggles, `popstate`/`hashchange`, the Navigation API and a URL poll; the service worker also forwards `webNavigation` history/fragment events. Tracks **live** (the form now) vs **applied** (the search that produced the cards on screen) so scores are linked to the right search; "Analyzed only" mode asks for cache hits only; robust pill re-creation |
| `src/background/service-worker.ts` | `SEARCH_STATE`, lazy per-tab server search session, `GET_ANALYZED`, `SCORE_PENDING`, `READ_SEARCH` |
| `api/extension/search-session`, `analyzed` + `SearchSession/SearchHit` | Same search ⇒ same session; list "this search" or "whole job" from the cache — **no LLM** |
| `sidepanel/components/SearchSyncBar.tsx` (new) | live search chips, "results are from the previous search" warning, **Auto-sync** into the query box, "Use Naukri's current search" |
| `sidepanel/components/AnalyzedTab.tsx` (new), `LiveRankingTab.tsx` | **Analyzed** tab (this search / whole job, min score, filter, Show on page); **Analyzed only** toggle + "Score N new cards" + "Not analyzed yet" list; "analyzed" badge on cache-served rows |
| `CandidateBoard.tsx` | "Analyzed only (full audit)" / "Card-level only" filter on the job board |

### 2.4 Multi-user login and per-HR isolation
* Dashboard: email + password (scrypt), DB-backed sessions in an httpOnly/SameSite=Lax cookie (only the token's SHA-256 is stored), same-origin check on mutations, login throttle. `src/middleware.ts` gates pages/APIs; `getSessionUser()` is the real check. Files: `lib/auth.ts`, `lib/user.ts`, `lib/http.ts` (`handleDash`, `handleExt`), `api/auth/{login,signup,logout}`, `login`, `signup` pages, `layout.tsx`.
* **Every** query is filtered by `userId` (jobs by `userId`, candidates by `job.userId`, résumés/cache/searches by `userId`); a foreign id is a plain 404. `ScoreCache` is per HR, so scores are never shared between HRs.
* Extension: `AuthGate.tsx` logs in with email + password → `POST /api/extension/login` returns **that HR's** key. Logging in as a different HR (or server) wipes the previous HR's active job, query drafts and every tab's cached ranking/search; Log out does the same; a 401 (rotated key / removed HR) clears everything and returns to the login screen.
* Own keys: **Settings** page (`LlmKeysPanel`, `api/settings/llm-keys`) — AES-256-GCM at rest, only last 4 characters ever shown, tried before the shared pool, optional "own keys only", live pool health (`api/settings/llm-status`).
* Regenerating the extension key (Extension page) signs that HR's extension out everywhere.

---

## 3. Behaviour notes
* Key health is **in memory per server instance** (Vercel instances don't share it). A cold instance re-discovers a cooling key with one 429; nothing else is lost.
* Gemini has no rate-limit headers, so Gemini keys are managed from 429 responses only. Default Gemini model is `gemini-2.5-flash` for all tiers; set `GEMINI_MODEL_DEEP=gemini-2.5-pro` if your quota allows.
* Cards without a profile link are identified by a text fingerprint; a candidate whose card text changes becomes a new entry in the analyzed list.
* Scores made before this upgrade have no `rubricHash`; they keep showing on the board, and are simply re-scored (once) when the same candidate is scanned again.
* Search sessions are created lazily — only when cards are scored or the Analyzed tab is opened — so typing in the search box doesn't create database rows.

## 4. What was verified (and what was not)
Ran locally: `tsc --noEmit` on both projects; `next build`; extension `npm run build`.
* `npm test` (web): 25 assertions — router rotation, 429 cooldown, proactive switch on low `x-ratelimit-remaining-tokens`, Groq→Gemini failover, own-keys-only, all-exhausted 429 + retry-after, bounded concurrency; text cleaning, cache keys, rubric hash, evidence guard, score gates.
* `tests/e2e/e2e.mjs`: 57 assertions against the built app + a real Postgres 16 + a mock Groq server — login gate, two-HR isolation (jobs, résumés, scoring, analyzed lists), cache hit/miss/invalidate, résumé store/view/download/score (real PDF + DOCX), key storage.
* `extension/tests/content.test.cjs` (24) and `ext.e2e.cjs` (18): the built content script on a Resdex-like page, and the **real built extension in Chromium** against the running backend — UI login, scoring, live search sync, Analyzed tab, Analyzed-only, logout/HR switch, revoked key.

**Not verified:** live calls to Groq or Gemini (a mock stood in; the Gemini `responseJsonSchema` request is untested against Google and falls back automatically to a prompt-embedded schema if rejected), the real Naukri Resdex DOM (the reader is heuristic and was tested on a synthetic page — check the "Naukri search (live)" box on a real search and send me any field it misses), an actual Vercel deployment, and Chrome's docked side-panel surface (the panel was exercised as a tab).
