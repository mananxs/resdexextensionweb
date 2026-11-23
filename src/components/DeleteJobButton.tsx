"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Deletes a job AND all its candidates (DB cascade). Always asks first. */
export default function DeleteJobButton({ id, title, count, redirectTo, compact }: { id: string; title: string; count: number; redirectTo?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function del() {
    const warn = count > 0 ? `\n\nThis also permanently deletes its ${count} saved candidate${count === 1 ? "" : "s"} and any uploaded resumes.` : "";
    if (!window.confirm(`Delete job “${title}”?${warn}\n\nThis cannot be undone.`)) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Delete failed (${res.status})`);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={del}
        disabled={busy}
        className={compact ? "text-xs font-medium text-rose-600 hover:underline disabled:opacity-50" : "btn border border-rose-300 bg-white text-rose-700 hover:bg-rose-50"}
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {err && <span className="mt-1 text-[11px] text-rose-600">{err}</span>}
    </span>
  );
}
