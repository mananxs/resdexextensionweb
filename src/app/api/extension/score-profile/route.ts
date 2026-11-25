import { NextRequest } from "next/server";
import { auditProfile } from "@/lib/groq";
import { getOwnedJob, handleExt, json, preflight } from "@/lib/http";
import { candidateKey, contentHash } from "@/lib/keys";
import { getCachedMany, putCache } from "@/lib/scoreCache";
import { ScoreProfileBody, type Audit } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;

/** Deep audit of one profile. Same profile text + same rubric → cached audit (no LLM). */
export function POST(req: NextRequest) {
  return handleExt(req, async (user) => {
    const { jobId, rawText, profileUrl, force } = ScoreProfileBody.parse(await req.json());
    const { rubric, rubricHash, job } = await getOwnedJob(user.id, jobId);
    const key = candidateKey(rawText, profileUrl);
    const hash = contentHash(rawText);

    if (!force) {
      const hit = (await getCachedMany({ userId: user.id, jobId: job.id, rubricHash, kind: "deep", keys: [key] })).get(key);
      if (hit && hit.contentHash === hash) return json({ audit: hit.result as Audit, cached: true, key });
    }
    const audit = await auditProfile(rubric, rawText);
    await putCache({ userId: user.id, jobId: job.id, rubricHash, kind: "deep", candidateKey: key, contentHash: hash, score: audit.score, result: audit, displayName: audit.extracted.fullName, profileUrl: profileUrl ?? null });
    return json({ audit, cached: false, key });
  });
}
