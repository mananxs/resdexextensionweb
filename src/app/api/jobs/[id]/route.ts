import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/errors";
import { handleDash } from "@/lib/http";
import { rubricHash } from "@/lib/keys";
import { prisma } from "@/lib/prisma";
import { buildBooleanQuery, sanitizeBooleanQuery } from "@/lib/resdexQuery";
import { RubricZ } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const res = await prisma.job.deleteMany({ where: { id, userId: user.id } });
    if (!res.count) throw new HttpError(404, "Not found");
    return NextResponse.json({ ok: true });
  });
}

const PatchBody = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  department: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]).optional(),
  rawDescription: z.string().trim().min(40).max(30000).optional(),
  rubric: RubricZ.optional(),
});

/** Edit a job after creation: details, status and the full rubric (no new LLM call). A changed rubric changes rubricHash → old cached scores stop matching. */
export function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const b = PatchBody.parse(await req.json().catch(() => ({})));
    const existing = await prisma.job.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) throw new HttpError(404, "Not found");

    let rubric = b.rubric;
    if (rubric) {
      // Keep the Resdex query valid even if it was hand-edited into something broken.
      const bq = sanitizeBooleanQuery(rubric.booleanQuery) || buildBooleanQuery(rubric);
      rubric = { ...rubric, booleanQuery: bq, minExp: rubric.minExperienceYears, maxExp: rubric.maxExperienceYears };
    }
    const job = await prisma.job.update({
      where: { id },
      data: {
        ...(b.title !== undefined && { title: b.title }),
        ...(b.department !== undefined && { department: b.department || null }),
        ...(b.location !== undefined && { location: b.location || null }),
        ...(b.status !== undefined && { status: b.status }),
        ...(b.rawDescription !== undefined && { rawDescription: b.rawDescription }),
        ...(rubric && { parsedRubricJson: rubric, rubricHash: rubricHash(rubric) }),
      },
    });
    return NextResponse.json({ job: { id: job.id } });
  });
}
