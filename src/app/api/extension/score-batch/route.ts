import { NextRequest } from "next/server";
import { scoreBatch } from "@/lib/groq";
import { authenticate, getOwnedJob, handle, json, preflight } from "@/lib/http";
import { ScoreBatchBody } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;

export function POST(req: NextRequest) {
  return handle(async () => {
    const user = await authenticate(req);
    const { jobId, candidates } = ScoreBatchBody.parse(await req.json());
    const { rubric } = await getOwnedJob(user.id, jobId);
    const { results, missing } = await scoreBatch(rubric, candidates);
    return json({ results, missing });
  });
}
