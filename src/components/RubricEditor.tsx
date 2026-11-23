"use client";

import { useState } from "react";
import { buildBooleanQuery, isBalanced, MAX_BOOLEAN_CHARS } from "@/lib/resdexQuery";
import { REMOTE, SENIORITY, type Rubric } from "@/lib/schemas";

/** Chip input: Enter / comma adds, ✕ or Backspace removes. */
function TagInput({ value, onChange, tone, placeholder }: { value: string[]; onChange: (v: string[]) => void; tone: string; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    const have = new Set(value.map((v) => v.toLowerCase()));
    onChange([...value, ...items.filter((i) => !have.has(i.toLowerCase()))]);
    setDraft("");
  };
  return (
    <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white p-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
      {value.map((t) => (
        <span key={t} className={`group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="opacity-50 hover:opacity-100" onClick={() => onChange(value.filter((v) => v !== t))}>
            ✕
          </button>
        </span>
      ))}
      <input
        className="min-w-[110px] flex-1 bg-transparent px-1.5 py-1 text-sm outline-none"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

/** Number field where blank ⇄ -1 ("not specified"). */
function Num({ value, onChange, placeholder, suffix }: { value: number; onChange: (n: number) => void; placeholder: string; suffix: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        min={0}
        step="any"
        className="input pr-12"
        placeholder={placeholder}
        value={value >= 0 ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? -1 : Math.max(0, Number(e.target.value)))}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>
    </div>
  );
}

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-baseline justify-between text-xs font-semibold text-slate-600">
        {label}
        {hint && <span className="font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export default function RubricEditor({ rubric, onChange }: { rubric: Rubric; onChange: (r: Rubric) => void }) {
  const set = <K extends keyof Rubric>(k: K, v: Rubric[K]) => onChange({ ...rubric, [k]: v });

  return (
    <div className="space-y-4">
      <Field label="Must-have skills" hint="Enter or comma to add">
        <TagInput value={rubric.mustHaveSkills} onChange={(v) => set("mustHaveSkills", v)} tone="bg-indigo-50 text-indigo-700" placeholder="Add skill…" />
      </Field>
      <Field label="Important skills" hint="strongly preferred / core to the role">
        <TagInput value={rubric.importantSkills} onChange={(v) => set("importantSkills", v)} tone="bg-blue-50 text-blue-700" placeholder="Add skill…" />
      </Field>
      <Field label="Nice-to-have skills">
        <TagInput value={rubric.niceToHaveSkills} onChange={(v) => set("niceToHaveSkills", v)} tone="bg-sky-50 text-sky-700" placeholder="Add skill…" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Min experience">
          <Num value={rubric.minExperienceYears} onChange={(n) => onChange({ ...rubric, minExperienceYears: n, minExp: n })} placeholder="Any" suffix="yrs" />
        </Field>
        <Field label="Max experience">
          <Num value={rubric.maxExperienceYears} onChange={(n) => onChange({ ...rubric, maxExperienceYears: n, maxExp: n })} placeholder="Open" suffix="yrs" />
        </Field>
        <Field label="Max notice period" hint="0 = immediate">
          <Num value={rubric.maxNoticePeriodDays} onChange={(n) => set("maxNoticePeriodDays", n)} placeholder="Any" suffix="days" />
        </Field>
        <Field label="Seniority">
          <select className="input capitalize" value={rubric.seniority} onChange={(e) => set("seniority", e.target.value as Rubric["seniority"])}>
            {SENIORITY.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="CTC budget min">
          <Num value={rubric.ctcBudgetMinLpa} onChange={(n) => set("ctcBudgetMinLpa", n)} placeholder="—" suffix="LPA" />
        </Field>
        <Field label="CTC budget max">
          <Num value={rubric.ctcBudgetMaxLpa} onChange={(n) => set("ctcBudgetMaxLpa", n)} placeholder="—" suffix="LPA" />
        </Field>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Locations">
          <TagInput value={rubric.locations} onChange={(v) => set("locations", v)} tone="bg-slate-100 text-slate-700" placeholder="Add city…" />
        </Field>
        <Field label="Work mode">
          <select className="input capitalize" value={rubric.remotePolicy} onChange={(e) => set("remotePolicy", e.target.value as Rubric["remotePolicy"])}>
            {REMOTE.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      <details className="rounded-lg border border-slate-200 bg-white p-3" open>
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">Deeper criteria <span className="font-normal text-slate-400">— each one affects the match score</span></summary>
        <div className="mt-3 space-y-4">
          <Field label="Skill depth" hint="minimum years per skill">
            <div className="space-y-1.5">
              {rubric.skillMinYears.map((x, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input" placeholder="Skill" value={x.skill} onChange={(e) => set("skillMinYears", rubric.skillMinYears.map((y, j) => (j === i ? { ...y, skill: e.target.value } : y)))} />
                  <input className="input w-24" type="number" min={0} step="0.5" value={x.years} onChange={(e) => set("skillMinYears", rubric.skillMinYears.map((y, j) => (j === i ? { ...y, years: Number(e.target.value) } : y)))} />
                  <button type="button" className="px-2 text-slate-400 hover:text-rose-600" onClick={() => set("skillMinYears", rubric.skillMinYears.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                </div>
              ))}
              <button type="button" className="text-xs font-medium text-indigo-600 hover:underline" onClick={() => set("skillMinYears", [...rubric.skillMinYears, { skill: "", years: 3 }])}>
                + Add skill depth
              </button>
            </div>
          </Field>
          <Field label="Education" hint="leave blank if not required">
            <div className="flex items-center gap-3">
              <input className="input" placeholder="e.g. B.Tech / BE in CS or equivalent" value={rubric.education} onChange={(e) => set("education", e.target.value)} />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={rubric.educationRequired} onChange={(e) => set("educationRequired", e.target.checked)} /> Mandatory
              </label>
            </div>
          </Field>
          <Field label="Certifications">
            <TagInput value={rubric.certifications} onChange={(v) => set("certifications", v)} tone="bg-slate-100 text-slate-700" placeholder="Add certification…" />
          </Field>
          <Field label="Industries / domains">
            <TagInput value={rubric.industries} onChange={(v) => set("industries", v)} tone="bg-slate-100 text-slate-700" placeholder="e.g. fintech, e-commerce…" />
          </Field>
          <Field label="Company types">
            <TagInput value={rubric.companyTypes} onChange={(v) => set("companyTypes", v)} tone="bg-slate-100 text-slate-700" placeholder="e.g. product, startup, MNC…" />
          </Field>
          <Field label="Must have done (responsibilities)">
            <TagInput value={rubric.responsibilities} onChange={(v) => set("responsibilities", v)} tone="bg-teal-50 text-teal-700" placeholder="e.g. Led a team of 5…" />
          </Field>
          <Field label="Deal-breakers" hint="caps the score at 30">
            <TagInput value={rubric.dealBreakers} onChange={(v) => set("dealBreakers", v)} tone="bg-rose-50 text-rose-700" placeholder="e.g. Only service-company experience" />
          </Field>
        </div>
      </details>

      <Field label="Domain context">
        <textarea className="input h-16 resize-none" value={rubric.domainContext} onChange={(e) => set("domainContext", e.target.value)} />
      </Field>
      <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
        <div className="text-xs font-semibold text-violet-800">Resdex Boolean query <span className="font-normal text-violet-500">— pasted into the Resdex keyword box by the extension; you still press Search</span></div>
        <Field label="Boolean query" hint={`${rubric.booleanQuery.length}/${MAX_BOOLEAN_CHARS} chars`}>
          <textarea
            className={`input h-20 resize-none font-mono text-xs ${rubric.booleanQuery.length > MAX_BOOLEAN_CHARS || !isBalanced(rubric.booleanQuery) ? "border-rose-400" : ""}`}
            value={rubric.booleanQuery}
            onChange={(e) => set("booleanQuery", e.target.value)}
            placeholder='(React OR ReactJS) AND (Node.js OR NodeJS) NOT (Intern OR Trainee)'
          />
        </Field>
        <button type="button" className="text-xs font-medium text-violet-700 hover:underline" onClick={() => set("booleanQuery", buildBooleanQuery(rubric))}>
          ↻ Rebuild from keywords
        </button>
        <Field label="Must-have keywords" hint="3–5 non-negotiables">
          <TagInput value={rubric.mustHaveKeywords} onChange={(v) => set("mustHaveKeywords", v)} tone="bg-violet-100 text-violet-800" placeholder="Add keyword…" />
        </Field>
        <Field label="Exclude keywords" hint="become the NOT clause">
          <TagInput value={rubric.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} tone="bg-rose-50 text-rose-700" placeholder="Add negative keyword…" />
        </Field>
      </div>
      <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
        <div className="mb-2 text-xs font-semibold text-violet-800">Resdex search plan <span className="font-normal text-violet-500">— plain keywords, no Boolean</span></div>
        <div className="space-y-2">
          {rubric.searchVariants.map((v, i) => (
            <div key={i} className="flex gap-2">
              <input className="input w-28 font-medium" value={v.label} onChange={(e) => set("searchVariants", rubric.searchVariants.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
              <input className="input" value={v.keywords} onChange={(e) => set("searchVariants", rubric.searchVariants.map((y, j) => (j === i ? { ...y, keywords: e.target.value } : y)))} />
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-3">
          <Field label="Target titles / designations" hint="shown as a Resdex filter">
            <TagInput value={rubric.targetTitles} onChange={(v) => set("targetTitles", v)} tone="bg-violet-100 text-violet-800" placeholder="Add title…" />
          </Field>
          <Field label="Core keywords">
            <TagInput value={rubric.coreKeywords} onChange={(v) => set("coreKeywords", v)} tone="bg-violet-100 text-violet-800" placeholder="Add keyword…" />
          </Field>
        </div>
      </div>
    </div>
  );
}
