"use client";

import { useCallback, useMemo, useState } from "react";
import { noticeToDays, tierClasses } from "@/lib/tier";
import { STATUSES, type CandidateDTO } from "@/lib/types";
import ResumeUploader from "./ResumeUploader";

const LABEL: Record<CandidateDTO["status"], string> = {
  SHORTLISTED: "Shortlisted",
  CONTACTED: "Contacted",
  INTERVIEWING: "Interviewing",
  OFFERED: "Offered",
  REJECTED: "Rejected",
};

const FIT_CLS: Record<string, string> = {
  good: "text-emerald-700 bg-emerald-50",
  ok: "text-amber-700 bg-amber-50",
  risk: "text-rose-700 bg-rose-50",
  unknown: "text-slate-600 bg-slate-100",
};

function ScorePill({ score }: { score: number }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${tierClasses(score)}`}>{score}%</span>;
}

function StaleBadge() {
  return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800" title="The job's rubric changed after this candidate was scored — re-run the audit to refresh the score">Rubric changed</span>;
}

function CardOnlyBadge() {
  return <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600" title="Saved from a search card — profile not opened yet, no contact details">Card only</span>;
}

export default function CandidateBoard({ jobId, candidates: initial }: { jobId: string; candidates: CandidateDTO[] }) {
  const [items, setItems] = useState(initial);
  const upsertItem = useCallback((c: CandidateDTO) => setItems((xs) => (xs.some((x) => x.id === c.id) ? xs.map((x) => (x.id === c.id ? c : x)) : [c, ...xs])), []);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [minScore, setMinScore] = useState(0);
  const [maxNotice, setMaxNotice] = useState(0); // 0 = any
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<"all" | "full" | "card">("all"); // "Analyzed only" = deep audit / résumé scored
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      items
        .filter((c) => c.aiScore >= minScore)
        .filter((c) => level === "all" || c.profileLevel === level)
        .filter((c) => {
          if (!maxNotice) return true;
          const d = noticeToDays(c.noticePeriod);
          return d !== null && d <= maxNotice;
        })
        .filter((c) => !q || `${c.fullName} ${c.currentRole} ${c.currentCompany} ${c.matchedSkills.join(" ")}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.aiScore - a.aiScore),
    [items, minScore, maxNotice, q, level],
  );
  const open = items.find((c) => c.id === openId) ?? null;
  const [textView, setTextView] = useState<{ title: string; text: string } | null>(null);
  async function showText(url: string, title: string) {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    setTextView({ title, text: res.ok ? body.text || "(No text could be extracted — download the file instead.)" : body.error ?? "Failed to load" });
  }

  async function setStatus(id: string, status: CandidateDTO["status"]) {
    const prev = items;
    setItems((xs) => xs.map((c) => (c.id === id ? { ...c, status } : c)));
    const res = await fetch(`/api/candidates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) setItems(prev);
  }

  function Card({ c }: { c: CandidateDTO }) {
    return (
      <button onClick={() => setOpenId(c.id)} className="card w-full p-3 text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{c.fullName}</div>
            <div className="truncate text-xs text-slate-500">{[c.currentRole, c.currentCompany].filter(Boolean).join(" @ ")}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <ScorePill score={c.aiScore} />
            {c.profileLevel === "card" && <CardOnlyBadge />}
            {c.stale && <StaleBadge />}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          {c.totalExp !== null && <span>{c.totalExp} yrs</span>}
          {c.currentCtc !== null && <span>{c.currentCtc} LPA</span>}
          {c.noticePeriod && <span>{c.noticePeriod}</span>}
        </div>
        <p className="mt-2 line-clamp-2 text-xs text-slate-600">{c.aiVerdict}</p>
      </button>
    );
  }

  return (
    <div>
      <ResumeUploader jobId={jobId} onCandidate={upsertItem} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Search name, role, skill…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={level} onChange={(e) => setLevel(e.target.value as typeof level)} title="Full = deep audit or résumé scored · Card = scored from a search card only">
          <option value="all">All candidates</option>
          <option value="full">Analyzed only (full audit)</option>
          <option value="card">Card-level only</option>
        </select>
        <select className="input w-auto" value={minScore} onChange={(e) => setMinScore(+e.target.value)}>
          <option value={0}>Any score</option>
          <option value={60}>60%+ (Good fit)</option>
          <option value={80}>80%+ (Top match)</option>
        </select>
        <select className="input w-auto" value={maxNotice} onChange={(e) => setMaxNotice(+e.target.value)}>
          <option value={0}>Any notice period</option>
          <option value={15}>≤ 15 days</option>
          <option value={30}>≤ 30 days</option>
          <option value={60}>≤ 60 days</option>
        </select>
        <div className="ml-auto flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {(["kanban", "table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 capitalize ${view === v ? "bg-indigo-600 text-white" : "text-slate-600"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="font-medium">No candidates shortlisted yet</p>
          <p className="mt-1 text-sm text-slate-500">Save a card or profile from the Resdex extension, or upload resumes (PDF/DOCX) above.</p>
        </div>
      ) : view === "kanban" ? (
        <div className="grid gap-4 overflow-x-auto md:grid-cols-5">
          {STATUSES.map((s) => {
            const col = filtered.filter((c) => c.status === s);
            return (
              <div key={s} className="min-w-[220px] rounded-xl bg-slate-100 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {LABEL[s]} <span className="rounded bg-white px-1.5 py-0.5 text-slate-500">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((c) => (
                    <Card key={c.id} c={c} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {["Score", "Candidate", "Exp", "CTC (cur → exp)", "Notice", "Location", "Status"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <ScorePill score={c.aiScore} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 font-medium">
                      {c.fullName} {c.profileLevel === "card" && <CardOnlyBadge />}
                    </div>
                    <div className="text-xs text-slate-500">{[c.currentRole, c.currentCompany].filter(Boolean).join(" @ ")}</div>
                  </td>
                  <td className="px-3 py-2">{c.totalExp ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.currentCtc ?? "—"} → {c.expectedCtc ?? "—"}
                  </td>
                  <td className="px-3 py-2">{c.noticePeriod ?? "—"}</td>
                  <td className="px-3 py-2">{c.location ?? "—"}</td>
                  <td className="px-3 py-2">{LABEL[c.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {textView && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setTextView(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <b className="truncate text-sm">{textView.title}</b>
              <button onClick={() => setTextView(null)} aria-label="Close" className="text-slate-500 hover:text-slate-900">✕</button>
            </div>
            <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap p-4 font-sans text-xs leading-relaxed text-slate-800">{textView.text}</pre>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px] animate-fade" onClick={() => setOpenId(null)}>
          <aside className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl animate-slide" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{open.fullName}</h2>
                <p className="text-sm text-slate-500">{[open.currentRole, open.currentCompany].filter(Boolean).join(" @ ")}</p>
              </div>
              <button onClick={() => setOpenId(null)} aria-label="Close" className="text-slate-500 hover:text-slate-900">
                ✕
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-lg font-bold ring-1 ring-inset ${tierClasses(open.aiScore)}`}>{open.aiScore}%</span>
              <span className="text-sm font-medium text-slate-700">{open.aiTier}</span>
              {open.profileLevel === "card" && <CardOnlyBadge />}
              {open.stale && <StaleBadge />}
              <select className="input ml-auto w-auto" value={open.status} onChange={(e) => setStatus(open.id, e.target.value as CandidateDTO["status"])}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <p className="mt-3 text-sm text-slate-700">{open.aiVerdict}</p>

            <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
              <Info k="Experience" v={open.totalExp !== null ? `${open.totalExp} yrs` : null} />
              <Info k="Notice period" v={open.noticePeriod} />
              <Info k="Current CTC" v={open.currentCtc !== null ? `${open.currentCtc} LPA` : null} />
              <Info k="Expected CTC" v={open.expectedCtc !== null ? `${open.expectedCtc} LPA` : null} />
              <Info k="Location" v={open.location} />
              <Info k="Email" v={open.email} />
              <Info k="Phone" v={open.phone} />
            </dl>

            {open.audit && (
              <div className="mt-4 space-y-2 text-sm">
                {open.audit.noticeNote && <Fit label="Notice period" fit={open.audit.noticeFit} note={open.audit.noticeNote} />}
                {open.audit.ctcNote && <Fit label="CTC" fit={open.audit.ctcFit} note={open.audit.ctcNote} />}
                {open.audit.experienceNote && <p className="rounded bg-slate-50 p-2 text-slate-700">{open.audit.experienceNote}</p>}
              </div>
            )}

            {open.audit?.flags?.length ? (
              <div className="mt-4 space-y-1">
                {open.audit.flags.map((f) => (
                  <div key={f} className="rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">⚠ {f}</div>
                ))}
              </div>
            ) : null}
            {open.audit?.breakdown ? (
              <Section title="Why this score">
                <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Must-haves: <b>{open.audit.breakdown.coverage.must ?? "—"}{open.audit.breakdown.coverage.must !== null ? "%" : ""}</b></span>
                    <span>Important: <b>{open.audit.breakdown.coverage.important ?? "—"}{open.audit.breakdown.coverage.important !== null ? "%" : ""}</b></span>
                    <span>Nice-to-have: <b>{open.audit.breakdown.coverage.nice ?? "—"}{open.audit.breakdown.coverage.nice !== null ? "%" : ""}</b></span>
                    <span>Evidence confidence: <b className="capitalize">{open.audit.breakdown.confidence}</b></span>
                  </div>
                  {open.audit.breakdown.gates.length > 0 ? (
                    <ul className="mt-1.5 list-disc pl-4 text-amber-800">
                      {open.audit.breakdown.gates.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-slate-500">No caps applied — weighted score {open.audit.breakdown.rawScore}%.</p>
                  )}
                </div>
              </Section>
            ) : null}
            {open.audit?.gaps?.length ? (
              <Section title="Gaps vs. the rubric">
                <List items={open.audit.gaps} />
              </Section>
            ) : null}
            {open.audit?.checks?.length ? (
              <Section title="Requirement checklist">
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                  {open.audit.checks.map((c) => (
                    <li key={c.label} className="flex items-start gap-2 px-3 py-1.5">
                      <span className={c.level === 2 ? "text-emerald-600" : c.level === 1 ? "text-amber-500" : "text-rose-500"}>{c.level === 2 ? "✓" : c.level === 1 ? "◐" : "✕"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {c.label}
                          {c.tier === "must" && <span className="ml-1.5 rounded bg-indigo-50 px-1 text-[10px] font-semibold uppercase text-indigo-600">must</span>}
                        </div>
                        {c.evidence && <div className="text-xs text-slate-500">{c.evidence}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
            <Section title="Matched skills">
              <Chips items={open.matchedSkills} cls="bg-emerald-50 text-emerald-700" />
            </Section>
            <Section title="Gaps / missing">
              <Chips items={open.missingSkills} cls="bg-rose-50 text-rose-700" />
            </Section>
            {open.audit?.strengths?.length ? (
              <Section title="Strengths">
                <List items={open.audit.strengths} />
              </Section>
            ) : null}
            {open.audit?.risks?.length ? (
              <Section title="Risks">
                <List items={open.audit.risks} />
              </Section>
            ) : null}
            {open.interviewQuestions.length > 0 ? (
              <Section title="Interview talking points">
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                  {open.interviewQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ol>
              </Section>
            ) : (
              open.profileLevel === "card" && (
                <p className="mt-5 rounded bg-slate-50 p-2 text-xs text-slate-600">
                  Saved from a search card — no CV view was spent. Email/phone and the deep audit are added automatically if you later open the profile and click “Save &amp; Shortlist”.
                </p>
              )
            )}

            {open.resume && (
              <div className="mt-6 flex gap-2">
                {open.resume.isPdf ? (
                  <a href={open.resume.viewUrl} target="_blank" rel="noreferrer" className="btn-ghost flex-1">
                    View resume
                  </a>
                ) : (
                  open.resume.textUrl && (
                    <button className="btn-ghost flex-1" onClick={() => void showText(open.resume!.textUrl!, open.resume!.fileName)}>
                      View as text
                    </button>
                  )
                )}
                <a href={open.resume.downloadUrl} className="btn-ghost flex-1" download title={open.resume.fileName}>
                  Download
                </a>
              </div>
            )}
            {open.naukriProfileUrl && (
              <a href={open.naukriProfileUrl} target="_blank" rel="noreferrer" className="btn-primary mt-6 w-full">
                Open on Resdex ↗
              </a>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Info({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{k}</dt>
      <dd className="truncate font-medium">{v ?? "—"}</dd>
    </div>
  );
}
function Fit({ label, fit, note }: { label: string; fit?: string; note: string }) {
  return (
    <div className={`rounded p-2 ${FIT_CLS[fit ?? "unknown"]}`}>
      <b>{label}:</b> {note}
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}
function Chips({ items, cls }: { items: string[]; cls: string }) {
  if (!items.length) return <p className="text-sm text-slate-400">None</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span key={s} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
          {s}
        </span>
      ))}
    </div>
  );
}
function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}
