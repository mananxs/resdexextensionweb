"use client";

import Link from "next/link";
import { useState } from "react";

export default function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { email, name, password, inviteCode: inviteCode || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
      if (!res.ok) throw new Error(body.details?.[0] ?? body.error ?? "Something went wrong");
      // only follow same-site relative paths
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/jobs";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto mt-10 max-w-sm space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">{mode === "login" ? "Log in" : "Create your HR account"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "login" ? "Your jobs, candidates and résumés are private to your account." : "Each HR gets a separate workspace — nothing is shared between accounts."}
        </p>
      </div>
      {mode === "signup" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Your name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Work email</span>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 10 : undefined} />
        {mode === "signup" && <span className="mt-1 block text-[11px] text-slate-500">At least 10 characters, with letters and a number.</span>}
      </label>
      {mode === "signup" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Invite code (if your admin gave you one)</span>
          <input className="input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" />
        </label>
      )}
      {error && <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
      </button>
      <p className="text-center text-sm text-slate-500">
        {mode === "login" ? (
          <>
            New HR? <Link href="/signup" className="text-indigo-600 hover:underline">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href="/login" className="text-indigo-600 hover:underline">Log in</Link>
          </>
        )}
      </p>
    </form>
  );
}
