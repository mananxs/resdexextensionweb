import Link from "next/link";
import { notFound } from "next/navigation";
import CandidateBoard from "@/components/CandidateBoard";
import RubricPills from "@/components/RubricPills";
import { prisma } from "@/lib/prisma";
import { RubricZ } from "@/lib/schemas";
import type { CandidateDTO } from "@/lib/types";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const job = await prisma.job.findFirst({
    where: { id, userId: user.id },
    include: { candidates: { orderBy: { aiScore: "desc" } } },
  });
  if (!job) notFound();
  const rubric = RubricZ.safeParse(job.parsedRubricJson).data;

  const candidates: CandidateDTO[] = job.candidates.map((c) => ({
    id: c.id,
    jobId: c.jobId,
    fullName: c.fullName,
    currentRole: c.currentRole,
    currentCompany: c.currentCompany,
    totalExp: c.totalExp,
    currentCtc: c.currentCtc,
    expectedCtc: c.expectedCtc,
    noticePeriod: c.noticePeriod,
    location: c.location,
    email: c.email,
    phone: c.phone,
    naukriProfileUrl: c.naukriProfileUrl,
    aiScore: c.aiScore,
    aiTier: c.aiTier,
    matchedSkills: c.matchedSkills,
    missingSkills: c.missingSkills,
    aiVerdict: c.aiVerdict,
    interviewQuestions: c.interviewQuestions,
    audit: (c.auditJson as CandidateDTO["audit"]) ?? null,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobs" className="text-sm text-slate-500 hover:text-slate-800">
          ← All jobs
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{job.title}</h1>
        <p className="text-sm text-slate-500">{[job.department, job.location].filter(Boolean).join(" · ")}</p>
      </div>

      <details className="card p-5" open={candidates.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold">Evaluation rubric (extracted by Groq)</summary>
        <div className="mt-4">{rubric ? <RubricPills rubric={rubric} /> : <p className="text-sm text-rose-600">Rubric unavailable.</p>}</div>
      </details>

      <CandidateBoard candidates={candidates} />
    </div>
  );
}
