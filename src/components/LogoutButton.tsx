"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-600"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
    >
      Log out
    </button>
  );
}
