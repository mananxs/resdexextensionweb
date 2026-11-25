import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/errors";
import { handleDash } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const Body = z.object({ status: z.enum(["SHORTLISTED", "CONTACTED", "INTERVIEWING", "OFFERED", "REJECTED"]) });

export function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(400, "Invalid status");
    const res = await prisma.candidate.updateMany({ where: { id, job: { userId: user.id } }, data: { status: parsed.data.status } });
    if (!res.count) throw new HttpError(404, "Not found");
    return NextResponse.json({ ok: true });
  });
}

/** Deleting a candidate keeps the stored résumé in the HR's library (it just becomes unlinked) — files are only removed explicitly. */
export function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const res = await prisma.candidate.deleteMany({ where: { id, job: { userId: user.id } } });
    if (!res.count) throw new HttpError(404, "Not found");
    return NextResponse.json({ ok: true });
  });
}
