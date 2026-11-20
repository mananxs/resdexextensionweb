import Link from "next/link";
import NewJobModal from "@/components/NewJobModal";
import { prisma } from "@/lib/prisma";
import { RubricZ } from "@/lib/schemas";
import { tierClasses } from "@/lib/tier";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const user = await getCurrentUser();
  const jobs = await prisma.job.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { candidates: { select: { aiScore: true } } },
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="text-sm text-slate-500">Analyze a JD once — the Chrome extension scores Resdex candidates against it.</p>
        </div>
        <NewJobModal />
      </div>

      {jobs.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[
            ["Active jobs", jobs.filter((j) => j.status === "ACTIVE").length],
            ["Shortlisted", jobs.reduce((n, j) => n + j.candidates.length, 0)],
            ["Top matches (80%+)", jobs.reduce((n, j) => n + j.candidates.filter((c) => c.aiScore >= 80).length, 0)],
          ].map(([k, v]) => (
            <div key={k} className="card px-4 py-3">
              <div className="text-2xl font-semibold text-indigo-600">{v}</div>
              <div className="text-xs text-slate-500">{k}</div>
            </div>
          ))}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="card p-14 text-center">
          <div className="mb-3 text-5xl">📄</div>
          <p className="font-medium">No jobs yet</p>
          <p className="mt-1 text-sm text-slate-500">Click “New Job / Analyze JD” and paste a job description to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => {
            const rubric = RubricZ.safeParse(j.parsedRubricJson).data;
            const top = j.candidates.reduce((m, c) => Math.max(m, c.aiScore), 0);
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="card block p-5 transition hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold leading-snug">{j.title}</h2>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{j.status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{[j.department, j.location].filter(Boolean).join(" · ") || "—"}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {rubric?.mustHaveSkills.slice(0, 5).map((s) => (
                    <span key={s} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                  <span className="text-slate-600">{j.candidates.length} shortlisted</span>
                  {j.candidates.length > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tierClasses(top)}`}>Top {top}%</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
