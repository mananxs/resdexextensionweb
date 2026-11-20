"use client";

import { useState } from "react";
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
      <Field label="Nice-to-have skills">
        <TagInput value={rubric.niceToHaveSkills} onChange={(v) => set("niceToHaveSkills", v)} tone="bg-sky-50 text-sky-700" placeholder="Add skill…" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Min experience">
          <Num value={rubric.minExperienceYears} onChange={(n) => set("minExperienceYears", n)} placeholder="Any" suffix="yrs" />
        </Field>
        <Field label="Max experience">
          <Num value={rubric.maxExperienceYears} onChange={(n) => set("maxExperienceYears", n)} placeholder="Open" suffix="yrs" />
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

      <Field label="Domain context">
        <textarea className="input h-16 resize-none" value={rubric.domainContext} onChange={(e) => set("domainContext", e.target.value)} />
      </Field>
      <Field label="Resdex search keywords" hint="plain words — no Boolean">
        <TagInput value={rubric.coreKeywords} onChange={(v) => set("coreKeywords", v)} tone="bg-violet-50 text-violet-700" placeholder="Add keyword…" />
      </Field>
    </div>
  );
}
