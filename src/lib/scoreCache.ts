import type { Prisma } from "@prisma/client";
import { mapWithConcurrency } from "./llmRouter";
import { prisma } from "./prisma";

/**
 * Score cache keyed by (userId + jobId + candidateKey + rubricHash + kind).
 *  • same candidate, same content, same rubric  → served from here, NO LLM call;
 *  • candidate text changed (contentHash differs) → re-scored and the row overwritten;
 *  • rubric edited (rubricHash differs)           → old rows simply stop matching (and are reported as `stale`).
 * userId is part of every query, so one HR can never read or reuse another HR's scores.
 */

export type CacheKind = "card" | "deep";

export interface CacheRow {
  id: string;
  candidateKey: string;
  contentHash: string;
  kind: CacheKind;
  score: number;
  result: unknown;
  displayName: string | null;
  profileUrl: string | null;
  updatedAt: Date;
}

const toRow = (r: {
  id: string;
  candidateKey: string;
  contentHash: string;
  kind: string;
  score: number;
  resultJson: Prisma.JsonValue;
  displayName: string | null;
  profileUrl: string | null;
  updatedAt: Date;
}): CacheRow => ({ id: r.id, candidateKey: r.candidateKey, contentHash: r.contentHash, kind: r.kind as CacheKind, score: r.score, result: r.resultJson, displayName: r.displayName, profileUrl: r.profileUrl, updatedAt: r.updatedAt });

export async function getCachedMany(p: { userId: string; jobId: string; rubricHash: string; kind: CacheKind; keys: string[] }): Promise<Map<string, CacheRow>> {
  if (!p.keys.length) return new Map();
  const rows = await prisma.scoreCache.findMany({
    where: { userId: p.userId, jobId: p.jobId, rubricHash: p.rubricHash, kind: p.kind, candidateKey: { in: p.keys } },
  });
  return new Map(rows.map((r) => [r.candidateKey, toRow(r)]));
}

export interface PutArgs {
  userId: string;
  jobId: string;
  rubricHash: string;
  kind: CacheKind;
  candidateKey: string;
  contentHash: string;
  score: number;
  result: unknown;
  displayName?: string | null;
  profileUrl?: string | null;
}

export async function putCache(a: PutArgs): Promise<string> {
  const data = {
    contentHash: a.contentHash,
    score: Math.max(0, Math.min(100, Math.round(a.score))),
    resultJson: a.result as Prisma.InputJsonValue,
    displayName: a.displayName?.slice(0, 200) ?? null,
    profileUrl: a.profileUrl?.slice(0, 1000) ?? null,
  };
  const row = await prisma.scoreCache.upsert({
    where: { userId_jobId_candidateKey_rubricHash_kind: { userId: a.userId, jobId: a.jobId, candidateKey: a.candidateKey, rubricHash: a.rubricHash, kind: a.kind } },
    create: { userId: a.userId, jobId: a.jobId, candidateKey: a.candidateKey, rubricHash: a.rubricHash, kind: a.kind, ...data },
    update: data,
    select: { id: true },
  });
  return row.id;
}

/** Many writes with bounded DB concurrency (Neon pooled connections are precious). */
export async function putCacheMany(list: PutArgs[]): Promise<string[]> {
  const settled = await mapWithConcurrency(list, 6, (a) => putCache(a));
  return settled.flatMap((s) => (s.ok ? [s.value] : []));
}

/** Records that these cache rows were seen in this Naukri search (idempotent). Verifies the search belongs to the HR. */
export async function linkHits(userId: string, searchSessionId: string | undefined, cacheIds: string[]) {
  if (!searchSessionId || !cacheIds.length) return;
  const own = await prisma.searchSession.findFirst({ where: { id: searchSessionId, userId }, select: { id: true } });
  if (!own) return;
  await prisma.searchHit.createMany({ data: [...new Set(cacheIds)].map((scoreCacheId) => ({ searchSessionId, scoreCacheId })), skipDuplicates: true });
  await prisma.searchSession.update({ where: { id: searchSessionId }, data: { lastSeenAt: new Date() } }).catch(() => {});
}

export interface AnalyzedItem {
  key: string;
  kind: CacheKind;
  score: number;
  displayName: string | null;
  profileUrl: string | null;
  updatedAt: string;
  result: unknown;
}

/**
 * "Already analyzed" candidates for the current rubric — optionally only those seen in one Naukri search.
 * One entry per candidate (a deep audit wins over a card score). No LLM involved.
 */
export async function listAnalyzed(p: { userId: string; jobId: string; rubricHash: string; searchSessionId?: string; minScore?: number; limit?: number }) {
  const where: Prisma.ScoreCacheWhereInput = {
    userId: p.userId,
    jobId: p.jobId,
    rubricHash: p.rubricHash,
    score: { gte: p.minScore ?? 0 },
    ...(p.searchSessionId ? { hits: { some: { searchSessionId: p.searchSessionId } } } : {}),
  };
  const [rows, stale] = await Promise.all([
    prisma.scoreCache.findMany({ where, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: Math.min(p.limit ?? 300, 1000) }),
    prisma.scoreCache.count({ where: { userId: p.userId, jobId: p.jobId, rubricHash: { not: p.rubricHash } } }),
  ]);
  const best = new Map<string, CacheRow>();
  for (const r of rows.map(toRow)) {
    const cur = best.get(r.candidateKey);
    if (!cur || (r.kind === "deep" && cur.kind !== "deep")) best.set(r.candidateKey, r);
  }
  const items: AnalyzedItem[] = [...best.values()]
    .sort((a, b) => b.score - a.score)
    .map((r) => ({ key: r.candidateKey, kind: r.kind, score: r.score, displayName: r.displayName, profileUrl: r.profileUrl, updatedAt: r.updatedAt.toISOString(), result: r.result }));
  return { items, staleCount: stale };
}
