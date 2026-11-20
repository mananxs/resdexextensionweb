import type { Rubric } from "@/lib/schemas";

function Pill({ children, tone }: { children: React.ReactNode; tone: "must" | "nice" | "meta" | "kw" }) {
  const cls = {
    must: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    nice: "bg-sky-50 text-sky-700 ring-sky-200",
    meta: "bg-slate-100 text-slate-700 ring-slate-200",
    kw: "bg-violet-50 text-violet-700 ring-violet-200",
  }[tone];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{children}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const known = (n: number) => n >= 0;

export function experienceLabel(r: Rubric) {
  if (!known(r.minExperienceYears) && !known(r.maxExperienceYears)) return "Experience: not specified";
  if (known(r.minExperienceYears) && known(r.maxExperienceYears)) return `${r.minExperienceYears}–${r.maxExperienceYears} yrs`;
  if (known(r.minExperienceYears)) return `${r.minExperienceYears}+ yrs`;
  return `Up to ${r.maxExperienceYears} yrs`;
}
export function noticeLabel(r: Rubric) {
  if (!known(r.maxNoticePeriodDays)) return "Notice: not specified";
  return r.maxNoticePeriodDays === 0 ? "Immediate joiners" : `Notice ≤ ${r.maxNoticePeriodDays} days`;
}
export function ctcLabel(r: Rubric) {
  if (!known(r.ctcBudgetMinLpa) && !known(r.ctcBudgetMaxLpa)) return "CTC: not specified";
  if (known(r.ctcBudgetMinLpa) && known(r.ctcBudgetMaxLpa)) return `₹${r.ctcBudgetMinLpa}–${r.ctcBudgetMaxLpa} LPA`;
  return `Up to ₹${r.ctcBudgetMaxLpa >= 0 ? r.ctcBudgetMaxLpa : r.ctcBudgetMinLpa} LPA`;
}

export default function RubricPills({ rubric }: { rubric: Rubric }) {
  return (
    <div className="space-y-3">
      <Row label="Must-have skills">
        {rubric.mustHaveSkills.map((s) => (
          <Pill key={s} tone="must">
            {s}
          </Pill>
        ))}
      </Row>
      {(rubric.importantSkills ?? []).length > 0 && (
        <Row label="Important skills">
          {rubric.importantSkills.map((s) => (
            <Pill key={s} tone="must">
              {s}
            </Pill>
          ))}
        </Row>
      )}
      {rubric.niceToHaveSkills.length > 0 && (
        <Row label="Nice-to-have">
          {rubric.niceToHaveSkills.map((s) => (
            <Pill key={s} tone="nice">
              {s}
            </Pill>
          ))}
        </Row>
      )}
      <Row label="Fit criteria">
        <Pill tone="meta">{experienceLabel(rubric)}</Pill>
        <Pill tone="meta">{noticeLabel(rubric)}</Pill>
        <Pill tone="meta">{ctcLabel(rubric)}</Pill>
        <Pill tone="meta">
          {rubric.locations.length ? rubric.locations.join(", ") : "Any location"} · {rubric.remotePolicy}
        </Pill>
        {rubric.seniority !== "unspecified" && <Pill tone="meta">{rubric.seniority}</Pill>}
      </Row>
      {rubric.domainContext && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Domain context</div>
          <p className="text-sm text-slate-700">{rubric.domainContext}</p>
        </div>
      )}
      {((rubric.education ?? "") || (rubric.certifications ?? []).length > 0 || (rubric.industries ?? []).length > 0) && (
        <Row label="Background asked for">
          {rubric.education && <Pill tone="meta">🎓 {rubric.education}</Pill>}
          {(rubric.certifications ?? []).map((c) => <Pill key={c} tone="meta">📜 {c}</Pill>)}
          {(rubric.industries ?? []).map((c) => <Pill key={c} tone="meta">{c}</Pill>)}
          {(rubric.companyTypes ?? []).map((c) => <Pill key={c} tone="meta">{c}</Pill>)}
        </Row>
      )}
      {(rubric.dealBreakers ?? []).length > 0 && (
        <Row label="Deal-breakers">
          {rubric.dealBreakers.map((c) => (
            <span key={c} className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">⛔ {c}</span>
          ))}
        </Row>
      )}
      {(rubric.searchVariants ?? []).length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Resdex search plan</div>
          <ul className="space-y-1 text-sm">
            {rubric.searchVariants.map((v) => (
              <li key={v.label}>
                <b className="text-slate-700">{v.label}:</b> <code className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{v.keywords}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rubric.coreKeywords.length > 0 && (
        <Row label="Resdex search keywords (no Boolean)">
          {rubric.coreKeywords.map((s) => (
            <Pill key={s} tone="kw">
              {s}
            </Pill>
          ))}
        </Row>
      )}
    </div>
  );
}
