"use client";

import { useCallback, useEffect, useState } from "react";

interface View {
  groq: string[];
  gemini: string[];
  useShared: boolean;
  shared: { groq: number; gemini: number };
}
interface Status {
  providers: { provider: string; keys: { id: string; own: boolean; state: string; cooldownSec: number; remainingRequests: number | null; remainingTokens: number | null; ok: number; lastError: string | null }[] }[];
}

/** The HR's OWN Groq / Gemini keys (encrypted at rest, never shown again after saving) + live pool health. */
export default function LlmKeysPanel() {
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [groq, setGroq] = useState("");
  const [gemini, setGemini] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/settings/llm-keys"), fetch("/api/settings/llm-status")]);
    if (a.ok) setView(await a.json());
    if (b.ok) setStatus(await b.json());
  }, []);
  useEffect(() => void load(), [load]);

  async function put(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings/llm-keys", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setView(data);
      setMsg({ ok: true, text: okText });
      void load();
    } else setMsg({ ok: false, text: data.error ?? "Failed" });
    setBusy(false);
  }

  const split = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  return (
    <div className="card divide-y divide-slate-200">
      <div className="p-5">
        <h2 className="font-semibold">Your own AI keys (optional)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Add your own Groq and/or Gemini keys to use your personal quota. They are tried <b>before</b> the shared server pool and are encrypted at rest — only their last 4 characters are ever shown. Several keys per provider are rotated automatically.
        </p>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2">
        <KeyBox label="Groq keys" hint="gsk_… (one per line or comma-separated)" saved={view?.groq ?? []} value={groq} onChange={setGroq} onSave={() => put({ groq: split(groq) }, "Groq keys saved").then(() => setGroq(""))} onClear={() => put({ groq: [] }, "Groq keys removed")} busy={busy} />
        <KeyBox label="Gemini keys" hint="AIza… (one per line or comma-separated)" saved={view?.gemini ?? []} value={gemini} onChange={setGemini} onSave={() => put({ gemini: split(gemini) }, "Gemini keys saved").then(() => setGemini(""))} onClear={() => put({ gemini: [] }, "Gemini keys removed")} busy={busy} />
      </div>

      <div className="flex flex-wrap items-center gap-3 p-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={view?.useShared ?? true} disabled={busy || !view} onChange={(e) => void put({ useShared: e.target.checked }, e.target.checked ? "Shared pool enabled as fallback" : "Using only your own keys")} />
          Fall back to the shared server key pool when my keys are rate-limited
        </label>
        {view && (
          <span className="text-xs text-slate-500">
            Shared pool: {view.shared.groq} Groq · {view.shared.gemini} Gemini key(s)
          </span>
        )}
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</span>}
      </div>

      {status && (
        <div className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Key pool health</h3>
            <button className="text-xs text-indigo-600 hover:underline" onClick={() => void load()}>
              Refresh
            </button>
          </div>
          {status.providers.every((p) => p.keys.length === 0) ? (
            <p className="text-sm text-rose-600">No key is available. Add your own key above, or ask your admin to set GROQ_API_KEYS / GEMINI_API_KEYS.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {status.providers.flatMap((p) =>
                p.keys.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-14 font-medium capitalize">{p.provider}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">{k.own ? "yours" : "shared"} · {k.id.split(":")[2]}</span>
                    <span className={k.state === "healthy" ? "text-emerald-700" : k.state === "cooling" ? "text-rose-600" : "text-amber-700"}>
                      {k.state}
                      {k.cooldownSec ? ` (${k.cooldownSec}s)` : ""}
                    </span>
                    {k.remainingRequests !== null && <span className="text-slate-500">{k.remainingRequests} req left</span>}
                    {k.remainingTokens !== null && <span className="text-slate-500">{k.remainingTokens} tok left</span>}
                  </li>
                )),
              )}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Health is tracked per server instance and resets on cold starts.</p>
        </div>
      )}
    </div>
  );
}

function KeyBox(p: { label: string; hint: string; saved: string[]; value: string; onChange: (v: string) => void; onSave: () => void; onClear: () => void; busy: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        {p.label}
        {p.saved.length > 0 && (
          <button className="font-medium normal-case text-rose-600 hover:underline" onClick={p.onClear} disabled={p.busy}>
            Remove all
          </button>
        )}
      </div>
      {p.saved.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{p.saved.map((k, i) => <span key={i} className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-700">{k}</span>)}</div>}
      <textarea className="input h-20 resize-none font-mono text-xs" value={p.value} onChange={(e) => p.onChange(e.target.value)} placeholder={p.saved.length ? "Paste keys to REPLACE the saved ones" : p.hint} spellCheck={false} autoComplete="off" />
      <button className="btn-ghost mt-2" disabled={p.busy || !p.value.trim()} onClick={p.onSave}>
        {p.saved.length ? "Replace keys" : "Save keys"}
      </button>
    </div>
  );
}
