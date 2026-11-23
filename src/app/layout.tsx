import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "XS-NaukriAI",
  description: "AI sourcing agent for Naukri Resdex, powered by xs-naukriai",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/jobs" className="flex items-center gap-2 font-semibold">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-md shadow-indigo-500/30">R</span>
              XS-NaukriAI
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/jobs" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100">
                Jobs
              </Link>
              <Link href="/candidates" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100">
                Candidates
              </Link>
              <Link href="/extension-setup" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100">
                Extension setup
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
