import { NextRequest } from "next/server";
import { auditProfile } from "@/lib/groq";
import { getOwnedJob, handleExt, HttpError, json, preflight } from "@/lib/http";
import { upsertCardCandidate, upsertFullCandidate } from "@/lib/candidateUpsert";
import { candidateKey, contentHash } from "@/lib/keys";
import { getCachedMany, putCache } from "@/lib/scoreCache";
import { ImportCandidateBody } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;

/**
 * Two modes, both user-triggered from the extension:
 *  • `card`  → "Save Card to Shortlist": search-result-card data only. No LLM call, no email/phone (they're hidden until
 *              the profile is unlocked). Stored as SHORTLISTED.
 *  • `audit` / `rawText` → full profile import. If the same person was saved from a card earlier the record is merged:
 *              contact details + auditJson are added, the pipeline status is kept.
 * The job must belong to the authenticated HR (getOwnedJob) — importing into someone else's job id is a 404.
 */
export function POST(req: NextRequest) {
  return handleExt(req, async (user) => {
    const body = ImportCandidateBody.parse(await req.json());
    const { job, rubric, rubricHash } = await getOwnedJob(user.id, body.jobId);
    const webUrl = `/jobs/${job.id}`;

    if (body.card && !body.audit && !body.rawText) {
      const r = await upsertCardCandidate({ jobId: job.id, rubricHash, card: { ...body.card, naukriProfileUrl: body.card.naukriProfileUrl ?? body.profileUrl } });
      return json({ candidate: { id: r.candidate.id }, duplicate: r.duplicate, level: "card", keptFullProfile: r.skippedBecauseFull, webUrl }, r.duplicate ? 200 : 201);
    }

    let audit = body.audit;
    if (!audit) {
      if (!body.rawText) throw new HttpError(400, "Provide `card`, `audit` or `rawText`");
      const key = candidateKey(body.rawText, body.profileUrl);
      const hit = (await getCachedMany({ userId: user.id, jobId: job.id, rubricHash, kind: "deep", keys: [key] })).get(key);
      if (hit && hit.contentHash === contentHash(body.rawText)) audit = hit.result as typeof audit;
      else {
        audit = await auditProfile(rubric, body.rawText);
        await putCache({ userId: user.id, jobId: job.id, rubricHash, kind: "deep", candidateKey: key, contentHash: contentHash(body.rawText), score: audit.score, result: audit, displayName: audit.extracted.fullName, profileUrl: body.profileUrl ?? null });
      }
    }
    const r = await upsertFullCandidate({ userId: user.id, jobId: job.id, audit: audit!, rawText: body.rawText, profileUrl: body.profileUrl, rubricHash });
    return json({ candidate: { id: r.candidate.id }, duplicate: r.duplicate, upgradedFromCard: r.upgradedFromCard, level: "full", webUrl }, r.duplicate ? 200 : 201);
  });
}
