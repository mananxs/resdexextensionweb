import { NextResponse } from "next/server";
import { handleDash } from "@/lib/http";
import { HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getOwnedResume } from "@/lib/resumes";
import { fileResponse } from "@/lib/resumeResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** View (`?inline=1`, PDF only) or download a stored résumé. Ownership-checked: another HR's id is a 404. */
export function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const r = await getOwnedResume(user.id, id);
    return fileResponse(r.fileName, r.mimeType, r.data, new URL(req.url).searchParams.get("inline") === "1");
  });
}

export function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const res = await prisma.resume.deleteMany({ where: { id, userId: user.id } });
    if (!res.count) throw new HttpError(404, "Resume not found");
    return NextResponse.json({ ok: true });
  });
}
