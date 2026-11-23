"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Rubric } from "@/lib/schemas";
import RubricEditor from "./RubricEditor";

interface JobFields {
  id: string;
  title: string;
  department: string;
  location: string;
  status: "ACTIVE" | "PAUSED" | "CLOSED";
}

/** Edit a saved job: details, status and every rubric field (skills, experience, notice, CTC, Boolean query…). */
export default function EditJobButton({ job, rubric: initial }: { job: JobFields; rubric: Rubric }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(job);
  const [rubric, setRubric] = useState<Rubric>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, busy]);

  function openModal() {
    setF(job);
    setRubric(initial);
    setError("");
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: f.title, department: f.department, location: f.location, status: f.status, rubric: { ...rubric, title: f.title, department: f.department } }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-ghost" onClick={openModal}>
        Edit job
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-3 backdrop-blur-sm sm:p-8">
          <div className="card w-full max-w-3xl overflow-hidden" role="dialog" aria-modal="true">
            <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-4 text-white">
              <div>
                <h2 className="text-lg font-semibold">Edit job</h2>
                <p className="text-xs text-indigo-100">Changes apply to future scoring and Resdex search fill. Click Sync in the extension to pick them up.</p>
              </div>
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-full p-1 text-indigo-100 hover:bg-white/20" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="space-y-4 p-6">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Job title</span>
                <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Department</span>
                  <input className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Primary location</span>
                  <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Status</span>
                  <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as JobFields["status"] })}>
                    <option value="ACTIVE">Active (shown in extension)</option>
                    <option value="PAUSED">Paused</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </label>
              </div>
              <hr className="border-slate-200" />
              <RubricEditor rubric={rubric} onChange={setRubric} />
            </div>

            {error && <p className="mx-6 mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">⚠ {error}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
              <button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={busy || !f.title.trim() || rubric.mustHaveSkills.length === 0}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
