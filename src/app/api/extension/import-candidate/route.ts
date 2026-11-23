import { NextRequest } from "next/server";
import { auditProfile } from "@/lib/groq";
import { authenticate, getOwnedJob, handle, HttpError, json, preflight } from "@/lib/http";
import { upsertCardCandidate, upsertFullCandidate } from "@/lib/candidateUpsert";
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
 */
export function POST(req: NextRequest) {
  return handle(async () => {
    const user = await authenticate(req);
    const body = ImportCandidateBody.parse(await req.json());
    const { job, rubric } = await getOwnedJob(user.id, body.jobId);
    const webUrl = `/jobs/${job.id}`;

    if (body.card && !body.audit && !body.rawText) {
      const r = await upsertCardCandidate({ jobId: job.id, card: { ...body.card, naukriProfileUrl: body.card.naukriProfileUrl ?? body.profileUrl } });
      return json(
        { candidate: { id: r.candidate.id }, duplicate: r.duplicate, level: "card", keptFullProfile: r.skippedBecauseFull, webUrl },
        r.duplicate ? 200 : 201,
      );
    }

    let audit = body.audit;
    if (!audit) {
      if (!body.rawText) throw new HttpError(400, "Provide `card`, `audit` or `rawText`");
      audit = await auditProfile(rubric, body.rawText);
    }
    const r = await upsertFullCandidate({ jobId: job.id, audit, rawText: body.rawText, profileUrl: body.profileUrl });
    return json(
      { candidate: { id: r.candidate.id }, duplicate: r.duplicate, upgradedFromCard: r.upgradedFromCard, level: "full", webUrl },
      r.duplicate ? 200 : 201,
    );
  });
}
