# Web end-to-end test (real Next server + real Postgres, mock Groq)

```bash
# 1) a throw-away Postgres and the schema
export DATABASE_URL=postgresql://user@localhost:5432/xs_test DIRECT_URL=$DATABASE_URL
npx prisma db push

# 2) build and start the app pointed at the mock LLM (port 4010 is started by e2e.mjs itself)
SESSION_SECRET=$(openssl rand -hex 24) ALLOW_SIGNUP=true GROQ_API_KEYS=gsk_testtesttesttesttesttest0001 GROQ_BASE_URL=http://localhost:4010 \
  sh -c 'npm run build && npx next start -p 3100'

# 3) in another shell
node tests/e2e/e2e.mjs
```
Covers: login gate, two-HR isolation (jobs, résumés, analyzed lists, scoring), score cache hits/misses, rubric-change invalidation,
search sessions, résumé store/view/download/score, own-key storage. Runs against a database you can throw away.
