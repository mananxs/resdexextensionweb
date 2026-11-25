import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { tierClasses } from "@/lib/tier";
import ResumeLibrary from "@/components/ResumeLibrary";
import { listResumeDTOs } from "@/lib/resumes";
import { getPageUser } from "@/lib/user";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { SHORTLISTED: "Shortlisted", CONTACTED: "Contacted", INTERVIEWING: "Interviewing", OFFERED: "Offered", REJECTED: "Rejected" };

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ job?: string; all?: string }> }) {
  const sp = await searchParams;
  const user = await getPageUser();
  const showAll = sp.all === "1";
  const [jobs, candidates, resumes] = await Promise.all([
    prisma.job.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true } }),
    prisma.candidate.findMany({
      where: { job: { userId: user.id }, ...(sp.job ? { jobId: sp.job } : {}), ...(showAll ? {} : { status: "SHORTLISTED" }) },
      omit: { resumeData: true }, // never pull file bytes into a list
      include: { job: { select: { id: true, title: true } }, resumes: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, fileName: true, mimeType: true } } },
      orderBy: [{ aiScore: "desc" }, { createdAt: "desc" }],
    }),
    listResumeDTOs({ userId: user.id, ...(sp.job ? { jobId: sp.job } : {}) }),
  ]);
  const qs = (o: { job?: string; all?: string }) => {
    const p = new URLSearchParams();
    if (o.job) p.set("job", o.job);
    if (o.all) p.set("all", o.all);
    const s = p.toString();
    return `/candidates${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Candidates</h1>
          <p className="text-sm text-slate-500">{showAll ? "All saved candidates" : "Shortlisted candidates"} across your jobs — {candidates.length} shown.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={qs({ job: sp.job })} className={`rounded-full border px-3 py-1 ${!showAll ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600"}`}>
            Shortlisted
          </Link>
          <Link href={qs({ job: sp.job, all: "1" })} className={`rounded-full border px-3 py-1 ${showAll ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600"}`}>
            All statuses
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
        <Link href={qs({ all: sp.all })} className={`rounded-full px-2.5 py-1 ${!sp.job ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}>
          All jobs
        </Link>
        {jobs.map((j) => (
          <Link key={j.id} href={qs({ job: j.id, all: sp.all })} className={`rounded-full px-2.5 py-1 ${sp.job === j.id ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}>
            {j.title}
          </Link>
        ))}
      </div>

      {candidates.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="font-medium">No candidates here yet</p>
          <p className="mt-1 text-sm text-slate-500">Save cards or profiles from the Resdex extension, or upload resumes on a job page.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {["Score", "Candidate", "Job", "Exp", "Notice", "Contact", "Status", "Resume"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${tierClasses(c.aiScore)}`}>{c.aiScore}%</span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/jobs/${c.jobId}`} className="font-medium hover:text-indigo-600">
                      {c.fullName}
                    </Link>
                    {c.auditJson === null && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">Card only</span>}
                    <div className="text-xs text-slate-500">{[c.currentRole, c.currentCompany].filter(Boolean).join(" @ ")}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{c.job.title}</td>
                  <td className="px-3 py-2">{c.totalExp ?? "—"}</td>
                  <td className="px-3 py-2">{c.noticePeriod ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    <div>{c.email ?? "—"}</div>
                    <div className="text-slate-500">{c.phone ?? ""}</div>
                  </td>
                  <td className="px-3 py-2">{STATUS_LABEL[c.status]}</td>
                  <td className="px-3 py-2">
                    {c.resumes[0] || c.resumeName ? (
                      <span className="flex flex-col gap-0.5 text-xs font-medium">
                        {(c.resumes[0]?.mimeType ?? c.resumeMime) === "application/pdf" ? (
                          <a href={c.resumes[0] ? `/api/resumes/${c.resumes[0].id}?inline=1` : `/api/candidates/${c.id}/resume?inline=1`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                            View
                          </a>
                        ) : null}
                        <a href={c.resumes[0] ? `/api/resumes/${c.resumes[0].id}` : `/api/candidates/${c.id}/resume`} download className="text-indigo-600 hover:underline" title={c.resumes[0]?.fileName ?? c.resumeName ?? ""}>
                          ⬇ Download
                        </a>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">{c.naukriProfileUrl ? <a href={c.naukriProfileUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Resdex ↗</a> : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8">
        <ResumeLibrary initial={resumes} jobs={jobs} />
      </div>
    </div>
  );
}
