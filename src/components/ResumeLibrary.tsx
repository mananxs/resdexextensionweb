"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ResumeDTO } from "@/lib/resumes";

interface JobOpt {
  id: string;
  title: string;
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const OK = /\.(pdf|docx)$/i;

/**
 * Résumé library: upload / view / download / delete / "score against a job" — all without the extension.
 * Pass `jobId` to pin the library to one job (uploads attach to it); omit it for the HR's whole library.
 */
export default function ResumeLibrary({ initial, jobs, jobId }: { initial: ResumeDTO[]; jobs: JobOpt[]; jobId?: string }) {
  const [items, setItems] = useState(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [viewer, setViewer] = useState<{ title: string; text: string } | null>(null);
  const [scoring, setScoring] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);

  const shown = useMemo(
    () => items.filter((r) => !q || `${r.fileName} ${r.guessedName ?? ""}`.toLowerCase().includes(q.toLowerCase())),
    [items, q],
  );
  const jobTitle = useCallback((id: string | null) => jobs.find((j) => j.id === id)?.title, [jobs]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => OK.test(f.name) && f.size <= 4 * 1024 * 1024);
    const skipped = files.length - list.length;
    if (!list.length) return setMsg({ ok: false, text: "Only PDF/DOCX files up to 4 MB are accepted." });
    setBusy(true);
    setMsg(null);
    let stored = 0;
    const errs: string[] = [];
    // one file per request: Vercel rejects request bodies above ~4.5 MB
    for (let i = 0; i < list.length; i += 1) {
      const fd = new FormData();
      list.slice(i, i + 1).forEach((f) => fd.append("file", f));
      if (jobId) fd.append("jobId", jobId);
      const res = await fetch("/api/resumes", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { results?: { ok: boolean; fileName: string; error?: string; resume?: ResumeDTO }[]; error?: string };
      if (!res.ok || !body.results) {
        errs.push(body.error ?? `Upload failed (${res.status})`);
        continue;
      }
      for (const r of body.results) {
        if (r.ok && r.resume) {
          stored++;
          setItems((xs) => [r.resume!, ...xs.filter((x) => x.id !== r.resume!.id)]);
        }
        if (r.error) errs.push(`${r.fileName}: ${r.error}`);
      }
    }
    setBusy(false);
    setMsg({ ok: errs.length === 0, text: `${stored} stored${skipped ? `, ${skipped} skipped (not PDF/DOCX or > 4 MB)` : ""}${errs.length ? ` — ${errs.join(" · ")}` : ""}` });
  }

  async function view(r: ResumeDTO) {
    if (r.mimeType === "application/pdf") return void window.open(r.viewUrl, "_blank", "noopener");
    const res = await fetch(r.textUrl);
    const body = await res.json().catch(() => ({}));
    setViewer({ title: r.fileName, text: res.ok ? body.text || "(No text could be extracted — download the file instead.)" : body.error ?? "Failed to load" });
  }

  async function remove(r: ResumeDTO) {
    if (!confirm(`Delete ${r.fileName}? The file is removed permanently${r.candidateId ? " (the candidate and score stay)" : ""}.`)) return;
    const res = await fetch(`/api/resumes/${r.id}`, { method: "DELETE" });
    if (res.ok) setItems((xs) => xs.filter((x) => x.id !== r.id));
    else setMsg({ ok: false, text: "Delete failed" });
  }

  async function score(r: ResumeDTO) {
    const target = jobId ?? pick[r.id];
    if (!target) return setMsg({ ok: false, text: "Choose a job to score against first." });
    setScoring(r.id);
    setMsg(null);
    const res = await fetch(`/api/resumes/${r.id}/score`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: target }) });
    const body = await res.json().catch(() => ({}));
    setScoring(null);
    if (!res.ok) return setMsg({ ok: false, text: body.error ?? "Scoring failed" });
    setItems((xs) => xs.map((x) => (x.id === r.id ? { ...x, candidateId: body.candidate.id, jobId: target } : x)));
    setMsg({ ok: true, text: `${r.fileName}: ${body.candidate.fullName} scored ${body.candidate.aiScore}%${body.cached ? " (cached — no AI call)" : ""}. See it on the job page.` });
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-semibold">Resume library</h2>
          <p className="text-xs text-slate-500">Stored privately in your account. View and download any time — no extension needed.</p>
        </div>
        <input className="input ml-auto max-w-[220px]" placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input ref={input} type="file" hidden multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
        <button className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Upload resumes"}
        </button>
      </div>
      {msg && <p className={`mb-2 rounded p-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No resumes yet — upload PDF or DOCX files.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={r.fileName}>
                  {r.guessedName || r.fileName}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {r.guessedName ? `${r.fileName} · ` : ""}
                  {fmtSize(r.sizeBytes)} · {new Date(r.createdAt).toLocaleDateString()}
                  {jobTitle(r.jobId) ? ` · ${jobTitle(r.jobId)}` : ""}
                  {!r.hasText ? " · no text (scanned?)" : ""}
                </div>
              </div>
              {r.candidateId ? (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">Scored</span>
              ) : (
                <span className="flex items-center gap-1">
                  {!jobId && (
                    <select className="input !w-auto !py-1 text-xs" value={pick[r.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))}>
                      <option value="">Job…</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.title}
                        </option>
                      ))}
                    </select>
                  )}
                  <button className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-40" disabled={!r.hasText || scoring === r.id} onClick={() => void score(r)}>
                    {scoring === r.id ? "Scoring…" : "Score against job"}
                  </button>
                </span>
              )}
              <button className="text-xs font-medium text-slate-700 hover:underline" onClick={() => void view(r)}>
                View
              </button>
              <a className="text-xs font-medium text-slate-700 hover:underline" href={r.downloadUrl} download>
                Download
              </a>
              <button className="text-xs text-rose-600 hover:underline" onClick={() => void remove(r)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setViewer(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <b className="truncate text-sm">{viewer.title}</b>
              <button className="text-slate-500 hover:text-slate-900" onClick={() => setViewer(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap p-4 font-sans text-xs leading-relaxed text-slate-800">{viewer.text}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
