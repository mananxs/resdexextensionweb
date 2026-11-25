import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedJob, handleDash } from "@/lib/http";
import { scoreStoredResume } from "@/lib/resumeScoring";
import { getOwnedResume } from "@/lib/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ jobId: z.string().min(1), force: z.boolean().optional() });

/** "Score against job" for a résumé already in the library. Cached when the text and the job's rubric are unchanged. */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const body = Body.parse(await req.json().catch(() => ({})));
    const resume = await getOwnedResume(user.id, id);
    const { job, rubric, rubricHash } = await getOwnedJob(user.id, body.jobId);
    const r = await scoreStoredResume({ userId: user.id, jobId: job.id, rubric, rubricHash, resume, force: body.force });
    return NextResponse.json({ candidate: r.dto, duplicate: r.duplicate, upgradedFromCard: r.upgradedFromCard, cached: r.fromCache });
  });
}
