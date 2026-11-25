import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { sha256 } from "./crypto";
import { HttpError } from "./errors";
import { prisma } from "./prisma";

/**
 * Dashboard auth: email + password → server-side session (random token in an httpOnly cookie; only its SHA-256 is stored).
 * Every dashboard query is then scoped by `user.id` — that is what isolates one HR's jobs, rubrics, candidates, résumés,
 * search sessions and scored lists from another's. (The extension authenticates separately with a per-HR Bearer key.)
 */

export const SESSION_COOKIE = "xs_session";
const SESSION_DAYS = 30;

/* ───────── passwords (scrypt, per-user salt) ───────── */

const scrypt = (pw: string, salt: Buffer, keylen: number, N: number) =>
  new Promise<Buffer>((resolve, reject) => _scrypt(pw, salt, keylen, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 16384;
  const key = await scrypt(pw, salt, 64, N);
  return `scrypt$${N}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [kind, n, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(pw, Buffer.from(salt, "base64url"), expected.length, Number(n));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters";
  if (pw.length > 200) return "Password is too long";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Use letters and at least one number";
  return null;
}

/* ───────── sessions ───────── */

export async function startSession(userId: string, userAgent?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), userAgent: userAgent?.slice(0, 200) ?? null, expiresAt } });
  // opportunistic cleanup of expired rows (cheap, indexed)
  void prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } }).catch(() => {});
  jar.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** The logged-in HR for this request, or null. Cached per request. */
export const getSessionUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
});

/** API routes: throws 401 when not logged in. */
export async function requireUser() {
  const u = await getSessionUser();
  if (!u) throw new HttpError(401, "Please log in");
  return u;
}

/* ───────── tiny in-memory throttle for login/signup (per instance) ───────── */

const attempts = new Map<string, { n: number; reset: number }>();
export function throttle(key: string, max = 8, windowMs = 10 * 60_000) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  if (++a.n > max) throw new HttpError(429, "Too many attempts — try again in a few minutes", Math.ceil((a.reset - now) / 1000));
}
export const clearThrottle = (key: string) => void attempts.delete(key);

/** Same-site check for cookie-authenticated mutations (defence in depth on top of SameSite=Lax). */
export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser / same-origin fetches may omit it
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Bad Origin header");
  }
  if (originHost !== host) throw new HttpError(403, "Cross-site request blocked");
}
