"use client";

import { useEffect, useState } from "react";

export default function ApiKeyPanel({ initialKey }: { initialKey: string }) {
  const [key, setKey] = useState(initialKey);
  const [origin, setOrigin] = useState("");
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<"" | "key" | "url">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  async function copy(text: string, which: "key" | "url") {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  }

  async function regenerate() {
    if (!confirm("Regenerate the key? The extension will stop working until you paste the new key.")) return;
    setBusy(true);
    const res = await fetch("/api/settings/api-key", { method: "POST" });
    if (res.ok) setKey((await res.json()).apiKey);
    setBusy(false);
  }

  return (
    <div className="card divide-y divide-slate-200">
      <Field label="Platform URL (backend endpoint)">
        <code className="flex-1 truncate rounded bg-slate-100 px-3 py-2 text-sm">{origin || "…"}</code>
        <button className="btn-ghost" onClick={() => copy(origin, "url")}>
          {copied === "url" ? "Copied ✓" : "Copy"}
        </button>
      </Field>
      <Field label="Extension API key">
        <code className="flex-1 truncate rounded bg-slate-100 px-3 py-2 text-sm">{show ? key : "•".repeat(24) + key.slice(-4)}</code>
        <button className="btn-ghost" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </button>
        <button className="btn-ghost" onClick={() => copy(key, "key")}>
          {copied === "key" ? "Copied ✓" : "Copy"}
        </button>
        <button className="btn-ghost text-rose-600" disabled={busy} onClick={regenerate}>
          Regenerate
        </button>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-5">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
