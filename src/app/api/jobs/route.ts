import { NextResponse } from "next/server";
import { extractRubric } from "@/lib/groq";
import { handleDash } from "@/lib/http";
import { rubricHash } from "@/lib/keys";
import { prisma } from "@/lib/prisma";
import { CreateJobBody } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request) {
  return handleDash(req, async (user) => {
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
        rubricHash: rubricHash(rubric),
      },
    });
    return NextResponse.json({ job: { id: job.id } }, { status: 201 });
  });
}
