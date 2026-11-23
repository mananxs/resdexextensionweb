import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams the stored resume of one of the current user's candidates as a download. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const c = await prisma.candidate.findFirst({
    where: { id, job: { userId: user.id } },
    select: { resumeName: true, resumeMime: true, resumeData: true },
  });
  if (!c?.resumeData || !c.resumeName) return NextResponse.json({ error: "No resume stored for this candidate" }, { status: 404 });
  const safe = c.resumeName.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(c.resumeData, {
    headers: {
      "Content-Type": c.resumeMime ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(c.resumeName)}`,
      "Content-Length": String(c.resumeData.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
