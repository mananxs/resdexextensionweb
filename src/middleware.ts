import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate in front of everything: no session cookie → pages redirect to /login, dashboard APIs answer 401.
 * (This only checks that a cookie EXISTS — it can't touch the DB on the edge. The real check — token → session → user,
 * with expiry — runs in `getSessionUser()` inside every page and API handler, and every query is then scoped by that user id.)
 * Public: /login, /signup, /api/auth/* and /api/extension/* (the extension uses its own per-HR Bearer key + CORS).
 */
const COOKIE = "xs_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/signup" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/extension/")) return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please log in" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
