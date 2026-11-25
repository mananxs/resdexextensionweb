import { NextRequest } from "next/server";
import { scoreBatch, type ScoredCard } from "@/lib/groq";
import { getOwnedJob, handleExt, json, preflight } from "@/lib/http";
import { candidateKey, contentHash } from "@/lib/keys";
import { getCachedMany, linkHits, putCacheMany } from "@/lib/scoreCache";
import { ScoreBatchBody } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;

type Out = ScoredCard & { key: string; cached: boolean };

/**
 * Card scoring with a cache in front of the LLM.
 *   1. every card gets a stable candidateKey (profile URL, else text fingerprint) + contentHash;
 *   2. (userId, jobId, candidateKey, rubricHash, "card") hit with the SAME contentHash → returned as-is, zero LLM calls;
 *   3. only the remaining cards are scored (parallel chunks across the key pool), then cached;
 *   4. everything returned is linked to the HR's current Naukri search so it appears in "Analyzed only".
 * `onlyCached: true` skips step 3 entirely (those cards come back in `unscored`).
 */
export function POST(req: NextRequest) {
  return handleExt(req, async (user) => {
    const body = ScoreBatchBody.parse(await req.json());
    const { rubric, rubricHash, job } = await getOwnedJob(user.id, body.jobId);

    // identical cards inside one request are scored once
    const items = body.candidates.map((c) => ({ ...c, key: candidateKey(c.rawText, c.profileUrl), hash: contentHash(c.rawText) }));
    const cached = body.force ? new Map() : await getCachedMany({ userId: user.id, jobId: job.id, rubricHash, kind: "card", keys: [...new Set(items.map((i) => i.key))] });

    const out: Out[] = [];
    const cacheIds: string[] = [];
    const fresh: typeof items = [];
    const seenFresh = new Map<string, string>(); // key → domId already queued
    const dupOf = new Map<string, string[]>(); // queued domId → other domIds with the same key

    for (const it of items) {
      const row = cached.get(it.key);
      if (row && row.contentHash === it.hash) {
        out.push({ ...(row.result as ScoredCard), domId: it.domId, key: it.key, cached: true });
        cacheIds.push(row.id);
      } else if (seenFresh.has(it.key)) {
        dupOf.set(seenFresh.get(it.key)!, [...(dupOf.get(seenFresh.get(it.key)!) ?? []), it.domId]);
      } else {
        seenFresh.set(it.key, it.domId);
        fresh.push(it);
      }
    }

    let missing: string[] = [];
    let unscored: string[] = [];
    if (fresh.length && body.onlyCached) {
      unscored = fresh.flatMap((f) => [f.domId, ...(dupOf.get(f.domId) ?? [])]);
    } else if (fresh.length) {
      const scored = await scoreBatch(rubric, fresh.map((f) => ({ domId: f.domId, rawText: f.rawText })));
      missing = scored.missing.flatMap((id) => [id, ...(dupOf.get(id) ?? [])]);
      const byId = new Map(fresh.map((f) => [f.domId, f]));
      const toStore = scored.results.map((r) => {
        const f = byId.get(r.domId)!;
        return {
          userId: user.id,
          jobId: job.id,
          rubricHash,
          kind: "card" as const,
          candidateKey: f.key,
          contentHash: f.hash,
          score: r.score,
          result: { ...r, domId: "" },
          displayName: r.extracted.fullName,
          profileUrl: f.profileUrl ?? null,
        };
      });
      cacheIds.push(...(await putCacheMany(toStore)));
      for (const r of scored.results) {
        const f = byId.get(r.domId)!;
        out.push({ ...r, key: f.key, cached: false });
        for (const d of dupOf.get(r.domId) ?? []) out.push({ ...r, domId: d, key: f.key, cached: false });
      }
    }

    await linkHits(user.id, body.searchSessionId, cacheIds).catch(() => {});
    return json({
      results: out,
      missing,
      unscored,
      stats: { total: items.length, cached: out.filter((o) => o.cached).length, scored: out.filter((o) => !o.cached).length },
    });
  });
}
