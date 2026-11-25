import Link from "next/link";
import { notFound } from "next/navigation";
import EditJobButton from "@/components/EditJobButton";
import DeleteJobButton from "@/components/DeleteJobButton";
import CandidateBoard from "@/components/CandidateBoard";
import ResumeLibrary from "@/components/ResumeLibrary";
import RubricPills from "@/components/RubricPills";
import { CANDIDATE_RESUME_SELECT, toCandidateDTO } from "@/lib/dto";
import { rubricHash } from "@/lib/keys";
import { prisma } from "@/lib/prisma";
import { listResumeDTOs } from "@/lib/resumes";
import { RubricZ } from "@/lib/schemas";
import type { CandidateDTO } from "@/lib/types";
import { getPageUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getPageUser();
  const job = await prisma.job.findFirst({
    where: { id, userId: user.id },
    include: { candidates: { orderBy: { aiScore: "desc" }, omit: { resumeData: true }, include: CANDIDATE_RESUME_SELECT } },
  });
  if (!job) notFound();
  const rubric = RubricZ.safeParse(job.parsedRubricJson).data;
  const hash = rubric ? rubricHash(rubric) : null;

  const candidates: CandidateDTO[] = job.candidates.map((c) => toCandidateDTO(c, hash));
  // résumés on this job (scored or not) — viewable/downloadable without the extension
  const resumes = await listResumeDTOs({ userId: user.id, jobId: job.id });

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
            {rubric && <EditJobButton job={{ id: job.id, title: job.title, department: job.department ?? "", location: job.location ?? "", status: job.status }} rubric={rubric} />}
            <DeleteJobButton id={job.id} title={job.title} count={candidates.length} redirectTo="/jobs" />
          </div>
        </div>
      </div>

      <details className="card p-5" open={candidates.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold">Evaluation rubric (extracted by AI)</summary>
        <div className="mt-4">{rubric ? <RubricPills rubric={rubric} /> : <p className="text-sm text-rose-600">Rubric unavailable.</p>}</div>
      </details>

      <CandidateBoard jobId={job.id} candidates={candidates} />

      <ResumeLibrary jobId={job.id} initial={resumes} jobs={[{ id: job.id, title: job.title }]} />
    </div>
  );
}
