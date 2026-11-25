import type { User } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertSameOrigin, requireUser } from "./auth";
import { decryptSecret } from "./crypto";
import { HttpError } from "./errors";
import { LlmError, runWithLlmContext, type LlmContext } from "./llmRouter";
import { prisma } from "./prisma";
import { RubricZ, type Rubric } from "./schemas";
import { rubricHash } from "./keys";

export { HttpError };

/** Chrome extensions call from chrome-extension://<id>; allow all origins — auth is the per-HR Bearer token, never cookies. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extra?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { ...CORS_HEADERS, ...extra } });
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/* ───────── per-HR LLM keys ───────── */

const splitKeys = (s: string | null) => (s ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** The HR's own provider keys (decrypted just-in-time) + whether they may also use the shared pool. */
export function llmContextFor(user: Pick<User, "groqKeysEnc" | "geminiKeysEnc" | "useSharedKeys">): LlmContext {
  return {
    groqKeys: splitKeys(decryptSecret(user.groqKeysEnc)),
    geminiKeys: splitKeys(decryptSecret(user.geminiKeysEnc)),
    useShared: user.useSharedKeys,
  };
}

/* ───────── extension API (Bearer) ───────── */

export async function authenticate(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Missing Bearer token");
  const user = await prisma.user.findUnique({ where: { extensionApiKey: token } });
  if (!user) throw new HttpError(401, "Invalid or expired extension key — log in again");
  return user;
}

function errorResponse(e: unknown, cors: boolean) {
  const send = (body: unknown, status: number, headers?: Record<string, string>) =>
    cors ? json(body, status, headers) : NextResponse.json(body, { status, headers });
  if (e instanceof HttpError) return send({ error: e.message }, e.status, e.retryAfterSec ? { "Retry-After": String(e.retryAfterSec) } : undefined);
  if (e instanceof ZodError) return send({ error: "Invalid request", details: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  if (e instanceof LlmError) {
    const status = e.status === 429 ? 429 : e.kind === "nokeys" ? 503 : 502;
    return send({ error: e.message, retryAfterSec: e.retryAfterSec ?? null }, status, e.retryAfterSec ? { "Retry-After": String(e.retryAfterSec) } : undefined);
  }
  console.error("[api]", e);
  return send({ error: e instanceof Error ? e.message : "Internal error" }, 500);
}

/** Wraps an EXTENSION handler: CORS + Bearer auth + per-HR LLM key context + consistent JSON errors. */
export async function handleExt(req: NextRequest, fn: (user: User) => Promise<NextResponse>) {
  try {
    const user = await authenticate(req);
    return await runWithLlmContext(llmContextFor(user), () => fn(user));
  } catch (e) {
    return errorResponse(e, true);
  }
}

/** Wraps an extension handler that does NOT need a session yet (login). */
export async function handlePublic(fn: () => Promise<NextResponse>) {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e, true);
  }
}

/* ───────── dashboard API (session cookie) ───────── */

/** Wraps a DASHBOARD handler: session auth + same-origin check + per-HR LLM key context + consistent JSON errors. */
export async function handleDash(req: Request, fn: (user: User) => Promise<NextResponse | Response>) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    return await runWithLlmContext(llmContextFor(user), () => fn(user) as Promise<NextResponse>);
  } catch (e) {
    return errorResponse(e, false);
  }
}

/** Dashboard handler without auth (login / signup / logout). */
export async function handleOpen(req: Request, fn: () => Promise<NextResponse>) {
  try {
    assertSameOrigin(req);
    return await fn();
  } catch (e) {
    return errorResponse(e, false);
  }
}

/** A job the HR owns — the ONLY way routes load a job, so a foreign id is a plain 404. */
export async function getOwnedJob(userId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new HttpError(404, "Job not found");
  const rubric = RubricZ.safeParse(job.parsedRubricJson);
  if (!rubric.success) throw new HttpError(500, "Stored rubric is invalid — re-save the job");
  const hash = rubricHash(rubric.data as Rubric);
  if (job.rubricHash !== hash) void prisma.job.update({ where: { id: job.id }, data: { rubricHash: hash } }).catch(() => {});
  return { job, rubric: rubric.data as Rubric, rubricHash: hash };
}

/** Back-compat alias for older call sites. */
export const handle = async (fn: () => Promise<NextResponse>) => {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e, true);
  }
};
