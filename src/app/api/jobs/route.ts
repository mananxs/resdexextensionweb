import { NextResponse } from "next/server";
import { z } from "zod";
import { extractRubric } from "@/lib/groq";
import { prisma } from "@/lib/prisma";
import { CreateJobBody } from "@/lib/schemas";
import { getCurrentUser } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    const body = CreateJobBody.parse(await req.json());
    const rubric = body.rubric ?? (await extractRubric(body.rawDescription));
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        title: body.title || rubric.title || "Untitled role",
        department: body.department || null,
        location: body.location || rubric.locations[0] || null,
        rawDescription: body.rawDescription,
        parsedRubricJson: rubric,
      },
    });
    return NextResponse.json({ job: { id: job.id } }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to save job" }, { status: 500 });
  }
}
