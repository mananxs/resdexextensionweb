"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Rubric } from "@/lib/schemas";
import RubricEditor from "./RubricEditor";

type Mode = "upload" | "paste";
const ACCEPT = ".pdf,.docx,.txt,.md";

export default function NewJobModal() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("upload");
  const [drag, setDrag] = useState(false);
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [jd, setJd] = useState("");
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [analysedJd, setAnalysedJd] = useState("");
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);
  const [error, setError] = useState("");

  const stale = rubric !== null && analysedJd !== jd;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && busy === null && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, busy]);

  /** Fill every field from the analysis; everything stays editable afterwards. */
  const applyAnalysis = useCallback((text: string, r: Rubric) => {
    setJd(text);
    setAnalysedJd(text);
    setRubric(r);
    setTitle(r.title);
    setDepartment(r.department ?? "");
    setLocation(r.locations[0] ?? "");
  }, []);

  async function analyzeText() {
    setBusy("analyze");
    setError("");
    try {
      const res = await fetch("/api/jobs/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawDescription: jd }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      applyAnalysis(data.text, data.rubric);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(null);
    }
  }

  async function analyzeFile(file: File) {
    setBusy("analyze");
    setError("");
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/jobs/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      applyAnalysis(data.text, data.rubric);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
      setFileName("");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    if (!rubric) return;
    setBusy("save");
    setError("");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The (possibly hand-edited) rubric is saved as-is — no second Groq call.
        body: JSON.stringify({ title, department, location, rawDescription: jd, rubric: { ...rubric, title, department } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setOpen(false);
      router.push(`/jobs/${data.job.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(null);
    }
  }

  function reset() {
    setRubric(null);
    setJd("");
    setAnalysedJd("");
    setTitle("");
    setDepartment("");
    setLocation("");
    setFileName("");
    setError("");
  }

  const step = !rubric ? 1 : 2;

  return (
    <>
      <button className="btn-primary shadow-lg shadow-indigo-600/20" onClick={() => setOpen(true)}>
        <span className="text-lg leading-none">＋</span> New Job / Analyze JD
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-3 backdrop-blur-sm sm:p-8 animate-fade">
          <div className="card w-full max-w-5xl overflow-hidden animate-pop" role="dialog" aria-modal="true">
            {/* header */}
            <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-white">
              <div>
                <h2 className="text-lg font-semibold">New job</h2>
                <p className="text-xs text-indigo-100">Upload or paste a JD — Groq fills the fields, you fine-tune them.</p>
              </div>
              <div className="flex items-center gap-4">
                <ol className="hidden items-center gap-2 text-xs sm:flex">
                  {["Add JD", "Review & edit"].map((s, i) => (
                    <li key={s} className={`flex items-center gap-1.5 ${step >= i + 1 ? "text-white" : "text-indigo-200"}`}>
                      <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${step >= i + 1 ? "bg-white text-indigo-700" : "bg-indigo-500/60"}`}>{i + 1}</span>
                      {s}
                      {i === 0 && <span className="mx-1 text-indigo-300">›</span>}
                    </li>
                  ))}
                </ol>
                <button onClick={() => setOpen(false)} disabled={busy !== null} className="rounded-full p-1 text-indigo-100 hover:bg-white/20" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.1fr]">
              {/* LEFT: JD input */}
              <div className="space-y-4">
                <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
                  {(["upload", "paste"] as Mode[]).map((m) => (
                    <button key={m} onClick={() => setMode(m)} className={`rounded-md px-4 py-1.5 transition ${mode === m ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                      {m === "upload" ? "📄 Upload file" : "✍️ Paste text"}
                    </button>
                  ))}
                </div>

                {mode === "upload" && (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      const f = e.dataTransfer.files[0];
                      if (f) void analyzeFile(f);
                    }}
                    onClick={() => busy === null && fileRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/50"}`}
                  >
                    <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && void analyzeFile(e.target.files[0])} />
                    <div className="mb-2 text-4xl">{busy === "analyze" ? <span className="inline-block animate-spin">⚙️</span> : fileName ? "✅" : "⬆️"}</div>
                    <p className="font-medium text-slate-700">{busy === "analyze" ? `Reading ${fileName || "file"} & analyzing…` : fileName ? fileName : "Drop a JD here or click to browse"}</p>
                    <p className="mt-1 text-xs text-slate-500">PDF, DOCX or TXT · up to 5 MB</p>
                  </div>
                )}

                {(mode === "paste" || jd) && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                      <span>Job description text</span>
                      <span className="font-normal text-slate-400">{jd.length.toLocaleString()} chars</span>
                    </div>
                    <textarea
                      className="input h-56 resize-none font-mono text-xs leading-relaxed"
                      placeholder="Paste the full job description here…"
                      value={jd}
                      onChange={(e) => setJd(e.target.value)}
                    />
                    <button className="btn-primary w-full" disabled={busy !== null || jd.trim().length < 40} onClick={analyzeText}>
                      {busy === "analyze" ? "Analyzing with Groq…" : rubric ? (stale ? "✨ Re-analyze edited text" : "↻ Re-analyze") : "✨ Analyze JD with Groq"}
                    </button>
                  </div>
                )}
                {stale && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">JD text changed — re-analyze to refresh the fields (your manual edits will be replaced).</p>}
              </div>

              {/* RIGHT: editable fields */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-semibold">Job details & rubric</h3>
                  {rubric && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">Auto-filled · editable</span>
                  )}
                </div>

                {busy === "analyze" ? (
                  <div className="space-y-4" aria-busy>
                    {[100, 85, 95, 60, 90, 75].map((w, i) => (
                      <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-200" style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }} />
                    ))}
                    <p className="text-center text-xs text-slate-500">Groq is extracting skills, experience, notice period, CTC & location…</p>
                  </div>
                ) : rubric ? (
                  <div className="space-y-4 animate-fade">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Job title</span>
                      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">Department</span>
                        <input className="input" value={department} onChange={(e) => setDepartment(e.target.value)} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">Primary location</span>
                        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
                      </label>
                    </div>
                    <hr className="border-slate-200" />
                    <RubricEditor rubric={rubric} onChange={setRubric} />
                  </div>
                ) : (
                  <div className="grid place-items-center py-16 text-center text-sm text-slate-500">
                    <div className="mb-2 text-4xl">🧠</div>
                    <p>Title, skills, experience, notice period,<br />CTC, location & keywords appear here —<br />all editable before you save.</p>
                  </div>
                )}
              </div>
            </div>

            {error && <p className="mx-6 mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">⚠ {error}</p>}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
              <button className="text-sm text-slate-500 hover:text-slate-800 disabled:opacity-40" disabled={!rubric || busy !== null} onClick={reset}>
                Start over
              </button>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy !== null || !rubric || !title.trim() || rubric.mustHaveSkills.length === 0} onClick={save}>
                  {busy === "save" ? "Saving…" : "Save job →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
