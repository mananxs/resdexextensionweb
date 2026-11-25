import { NextResponse } from "next/server";
import { handleDash } from "@/lib/http";
import { HttpError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { fileResponse } from "@/lib/resumeResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the stored résumé of one of the current HR's candidates (`?inline=1` to view PDFs in the browser).
 * Prefers the independent Resume table; falls back to the legacy inline columns of candidates uploaded before it existed.
 */
export function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    const cand = await prisma.candidate.findFirst({
      where: { id, job: { userId: user.id } },
      select: { resumeName: true, resumeMime: true, resumeData: true, resumes: { where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 1, select: { fileName: true, mimeType: true, data: true } } },
    });
    if (!cand) throw new HttpError(404, "Not found");
    const r = cand.resumes[0];
    if (r) return fileResponse(r.fileName, r.mimeType, r.data, inline);
    if (cand.resumeData && cand.resumeName) return fileResponse(cand.resumeName, cand.resumeMime ?? "application/octet-stream", cand.resumeData, inline);
    return NextResponse.json({ error: "No resume stored for this candidate" }, { status: 404 });
  });
}
