import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

const Body = z.object({ status: z.enum(["SHORTLISTED", "CONTACTED", "INTERVIEWING", "OFFERED", "REJECTED"]) });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const res = await prisma.candidate.updateMany({
    where: { id, job: { userId: user.id } },
    data: { status: parsed.data.status },
  });
  return res.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const res = await prisma.candidate.deleteMany({ where: { id, job: { userId: user.id } } });
  return res.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
