import { prisma } from "./prisma";
import type { SearchState } from "./schemas";

/** Short human label for a search: keywords · location · exp. */
export function searchLabel(s: SearchState): string {
  const kw = (s.keywords || s.anyKeywords.join(" ")).replace(/\s+/g, " ").trim().slice(0, 60) || "Search";
  const exp = s.minExp !== null || s.maxExp !== null ? `${s.minExp ?? 0}–${s.maxExp ?? "∞"} yrs` : "";
  return [kw, s.location.split(/[,;]/)[0]?.trim(), exp].filter(Boolean).join(" · ");
}

/**
 * Upserts the HR's search (same job + same signature → same row). The signature is computed by the extension from the
 * canonical search state, so editing ANY keyword / filter yields a new search session — and the old one's analyzed list is kept.
 */
export async function upsertSearchSession(userId: string, jobId: string, signature: string, state: SearchState) {
  const label = searchLabel(state);
  const row = await prisma.searchSession.upsert({
    where: { userId_jobId_signature: { userId, jobId, signature } },
    create: { userId, jobId, signature, label, stateJson: state },
    update: { lastSeenAt: new Date(), stateJson: state, label },
    include: { _count: { select: { hits: true } } },
  });
  return { id: row.id, label: row.label, analyzedCount: row._count.hits, createdAt: row.createdAt.toISOString() };
}

export async function listSearchSessions(userId: string, jobId: string, limit = 20) {
  const rows = await prisma.searchSession.findMany({
    where: { userId, jobId },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
    include: { _count: { select: { hits: true } } },
  });
  return rows.map((r) => ({ id: r.id, label: r.label, signature: r.signature, analyzedCount: r._count.hits, lastSeenAt: r.lastSeenAt.toISOString(), state: r.stateJson }));
}
