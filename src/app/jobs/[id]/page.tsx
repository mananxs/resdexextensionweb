import Link from "next/link";
import { notFound } from "next/navigation";
import DeleteJobButton from "@/components/DeleteJobButton";
import CandidateBoard from "@/components/CandidateBoard";
import RubricPills from "@/components/RubricPills";
import { toCandidateDTO } from "@/lib/dto";
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
    include: { candidates: { orderBy: { aiScore: "desc" }, omit: { resumeData: true } } },
  });
  if (!job) notFound();
  const rubric = RubricZ.safeParse(job.parsedRubricJson).data;

  const candidates: CandidateDTO[] = job.candidates.map(toCandidateDTO);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobs" className="text-sm text-slate-500 hover:text-slate-800">
          ← All jobs
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{job.title}</h1>
            <p className="text-sm text-slate-500">{[job.department, job.location].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/candidates?job=${job.id}&all=1`} className="btn-ghost">
              Candidates
            </Link>
            <DeleteJobButton id={job.id} title={job.title} count={candidates.length} redirectTo="/jobs" />
          </div>
        </div>
      </div>

      <details className="card p-5" open={candidates.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold">Evaluation rubric (extracted by Groq)</summary>
        <div className="mt-4">{rubric ? <RubricPills rubric={rubric} /> : <p className="text-sm text-rose-600">Rubric unavailable.</p>}</div>
      </details>

      <CandidateBoard jobId={job.id} candidates={candidates} />
    </div>
  );
}
