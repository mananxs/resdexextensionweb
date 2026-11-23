import { NextResponse } from "next/server";
import { z } from "zod";
import { buildBooleanQuery, sanitizeBooleanQuery } from "@/lib/resdexQuery";
import { prisma } from "@/lib/prisma";
import { RubricZ } from "@/lib/schemas";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const res = await prisma.job.deleteMany({ where: { id, userId: user.id } });
  return res.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

const PatchBody = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  department: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]).optional(),
  rawDescription: z.string().trim().min(40).max(30000).optional(),
  rubric: RubricZ.optional(),
});

/** Edit a job after creation: details, status and the full rubric (no new Groq call). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const b = PatchBody.parse(await req.json().catch(() => ({})));
    const existing = await prisma.job.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
        ...(rubric && { parsedRubricJson: rubric }),
      },
    });
    return NextResponse.json({ job: { id: job.id } });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 500 });
  }
}
