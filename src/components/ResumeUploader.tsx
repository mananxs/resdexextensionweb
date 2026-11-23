"use client";

import { useCallback, useRef, useState } from "react";
import type { CandidateDTO } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024;
const OK_EXT = /\.(pdf|docx)$/i;

type Status = "queued" | "uploading" | "analyzing" | "done" | "error";
interface Item {
  id: number;
  file: File;
  status: Status;
  progress: number; // 0–100 of bytes sent
  message?: string;
}

interface ApiFileResult {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  upgradedFromCard?: boolean;
  candidate?: CandidateDTO;
}

/** POST one file with real upload progress (fetch can't report it). The server then spends 10–20 s auditing → "analyzing". */
function uploadOne(jobId: string, file: File, onProgress: (pct: number) => void, onSent: () => void): Promise<ApiFileResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/jobs/${jobId}/candidates/upload`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = onSent;
    xhr.onerror = () => resolve({ ok: false, error: "Network error — check your connection" });
    xhr.ontimeout = () => resolve({ ok: false, error: "Timed out" });
    xhr.onload = () => {
      const body = xhr.response as { results?: (ApiFileResult & { fileName: string })[]; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.results?.[0]) resolve(body.results[0]);
      else resolve({ ok: false, error: body?.error ?? `Upload failed (${xhr.status})` });
    };
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

export default function ResumeUploader({ jobId, onCandidate }: { jobId: string; onCandidate: (c: CandidateDTO) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const patch = useCallback((id: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x))), []);

  const processQueue = useCallback(
    async (queue: Item[]) => {
      setRunning(true);
      for (const it of queue) {
        // Sequential: each resume is a full AI audit; parallel uploads would trip Groq rate limits.
        patch(it.id, { status: "uploading", progress: 0, message: undefined });
        const r = await uploadOne(
          jobId,
          it.file,
          (progress) => patch(it.id, { progress }),
          () => patch(it.id, { status: "analyzing", progress: 100 }),
        );
        if (r.ok && r.candidate) {
          onCandidate(r.candidate);
          patch(it.id, {
            status: "done",
            progress: 100,
            message: r.upgradedFromCard
              ? `Merged into saved card · ${r.candidate.aiScore}%`
              : r.duplicate
                ? `Already on board — refreshed · ${r.candidate.aiScore}%`
                : `Added ${r.candidate.fullName} · ${r.candidate.aiScore}%`,
          });
        } else {
          patch(it.id, { status: "error", message: r.error ?? "Failed" });
        }
      }
      setRunning(false);
    },
    [jobId, onCandidate, patch],
  );

  const add = useCallback(
    (list: FileList | File[]) => {
      const fresh: Item[] = [];
      for (const file of Array.from(list)) {
        const reason = !OK_EXT.test(file.name) ? "Only PDF and DOCX files are supported" : file.size > MAX_BYTES ? "File is larger than 5 MB" : undefined;
        fresh.push({ id: nextId.current++, file, status: reason ? "error" : "queued", progress: 0, message: reason });
      }
      if (!fresh.length) return;
      setItems((xs) => [...xs, ...fresh]);
      const runnable = fresh.filter((f) => f.status === "queued");
      if (runnable.length) void processQueue(runnable);
    },
    [processQueue],
  );

  const retry = (it: Item) => void processQueue([it]);
  const clearFinished = () => setItems((xs) => xs.filter((x) => x.status === "queued" || x.status === "uploading" || x.status === "analyzing"));

  return (
    <div className="mb-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={`flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-sm transition ${drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white"}`}
      >
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
        <button type="button" className="btn-primary" onClick={() => input.current?.click()}>
          Upload Resumes (PDF/DOCX)
        </button>
        <span className="text-slate-500">or drop files here — each resume is read, scored against this job and added to the board (max 5 MB each).</span>
        {items.some((i) => i.status === "done" || i.status === "error") && !running && (
          <button type="button" className="ml-auto text-xs text-slate-500 hover:text-slate-900" onClick={clearFinished}>
            Clear finished
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm" aria-live="polite">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-4 text-center" aria-hidden>
                {it.status === "done" ? <span className="text-emerald-600">✓</span> : it.status === "error" ? <span className="text-rose-600">✕</span> : <span className="text-slate-400">•</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{it.file.name}</div>
                {it.status === "uploading" || it.status === "analyzing" || it.status === "queued" ? (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200">
                      <div className={`h-full bg-indigo-600 transition-all ${it.status === "analyzing" ? "animate-pulse" : ""}`} style={{ width: `${it.status === "queued" ? 0 : it.progress}%` }} />
                    </div>
                    <span className="w-28 text-right text-[11px] text-slate-500">
                      {it.status === "queued" ? "Queued" : it.status === "uploading" ? `Uploading ${it.progress}%` : "Analyzing with Groq…"}
                    </span>
                  </div>
                ) : (
                  <div className={`text-xs ${it.status === "error" ? "text-rose-600" : "text-emerald-700"}`}>{it.message}</div>
                )}
              </div>
              {it.status === "error" && OK_EXT.test(it.file.name) && it.file.size <= MAX_BYTES && !running && (
                <button type="button" className="text-xs font-medium text-indigo-600 hover:underline" onClick={() => retry(it)}>
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
