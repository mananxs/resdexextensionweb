import { NextRequest } from "next/server";
import { getOwnedJob, handleExt, json, preflight } from "@/lib/http";
import { SearchSessionBody } from "@/lib/schemas";
import { listSearchSessions, upsertSearchSession } from "@/lib/searchSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

/**
 * The extension reports the Naukri search it is looking at (keywords, location, experience, salary, filters).
 * Same job + same signature → same session id, so "analyzed in this search" is stable across reloads. Per HR.
 */
export function POST(req: NextRequest) {
  return handleExt(req, async (user) => {
    const body = SearchSessionBody.parse(await req.json());
    if (!body.jobId) return json({ error: "jobId is required" }, 400);
    const { job } = await getOwnedJob(user.id, body.jobId);
    return json({ session: await upsertSearchSession(user.id, job.id, body.signature, body.state) });
  });
}

/** Recent searches for a job (newest first) — the panel's "saved searches" picker. */
export function GET(req: NextRequest) {
  return handleExt(req, async (user) => {
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId) return json({ error: "jobId is required" }, 400);
    const { job } = await getOwnedJob(user.id, jobId);
    return json({ sessions: await listSearchSessions(user.id, job.id) });
  });
}
