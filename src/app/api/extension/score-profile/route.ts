import { NextRequest } from "next/server";
import { auditProfile } from "@/lib/groq";
import { authenticate, getOwnedJob, handle, json, preflight } from "@/lib/http";
import { ScoreProfileBody } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;

export function POST(req: NextRequest) {
  return handle(async () => {
    const user = await authenticate(req);
    const { jobId, rawText } = ScoreProfileBody.parse(await req.json());
    const { rubric } = await getOwnedJob(user.id, jobId);
    const audit = await auditProfile(rubric, rawText);
    return json({ audit });
  });
}
