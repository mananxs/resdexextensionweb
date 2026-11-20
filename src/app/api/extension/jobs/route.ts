import { NextRequest } from "next/server";
import { extractRubric } from "@/lib/groq";
import { authenticate, handle, json, preflight } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { CreateJobBody, RubricZ } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const OPTIONS = preflight;

export function GET(req: NextRequest) {
  return handle(async () => {
    const user = await authenticate(req);
    const jobs = await prisma.job.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { candidates: true } } },
    });
    return json({
      jobs: jobs.map((j) => ({
        id: j.id,
        title: j.title,
        department: j.department,
        location: j.location,
        status: j.status,
        candidateCount: j._count.candidates,
        rubric: RubricZ.safeParse(j.parsedRubricJson).data ?? null,
      })),
    });
  });
}

/** Creates a job from a pasted/ad-hoc JD; the Groq rubric is parsed once and cached in parsedRubricJson. */
export function POST(req: NextRequest) {
  return handle(async () => {
    const user = await authenticate(req);
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
    return json(
      { job: { id: job.id, title: job.title, department: job.department, location: job.location, status: job.status, candidateCount: 0, rubric } },
      201,
    );
  });
}
