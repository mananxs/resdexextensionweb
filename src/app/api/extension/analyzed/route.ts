import { NextRequest } from "next/server";
import { getOwnedJob, handleExt, json, preflight } from "@/lib/http";
import { listAnalyzed } from "@/lib/scoreCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/**
 * "Already analyzed" candidates (card scores + deep audits made under the job's CURRENT rubric) — for one saved search
 * (`searchSessionId`) or the whole job. Reads the cache only: no LLM call, nothing is re-scored.
 */
export function GET(req: NextRequest) {
  return handleExt(req, async (user) => {
    const q = new URL(req.url).searchParams;
    const jobId = q.get("jobId");
    if (!jobId) return json({ error: "jobId is required" }, 400);
    const { job, rubricHash } = await getOwnedJob(user.id, jobId);
    const r = await listAnalyzed({
      userId: user.id,
      jobId: job.id,
      rubricHash,
      searchSessionId: q.get("searchSessionId") || undefined,
      minScore: Number(q.get("minScore")) || 0,
      limit: Number(q.get("limit")) || 300,
    });
    return json(r);
  });
}
