import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "./prisma";
import { RubricZ, type Rubric } from "./schemas";

/** Chrome extensions call from chrome-extension://<id>; allow all origins — auth is the Bearer token. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function authenticate(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Missing Bearer token");
  const user = await prisma.user.findUnique({ where: { extensionApiKey: token } });
  if (!user) throw new HttpError(401, "Invalid extension API key");
  return user;
}

/** Wraps a handler: CORS + consistent JSON errors (Zod → 400, Groq 429 → 429). */
export async function handle(fn: () => Promise<NextResponse>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof ZodError) {
      return json({ error: "Invalid request", details: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    }
    const status = (e as { status?: number }).status;
    if (status === 429) return json({ error: "Groq rate limit hit — retry in a few seconds" }, 429);
    console.error("[api]", e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
}

export async function getOwnedJob(userId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new HttpError(404, "Job not found");
  const rubric = RubricZ.safeParse(job.parsedRubricJson);
  if (!rubric.success) throw new HttpError(500, "Stored rubric is invalid — re-save the job");
  return { job, rubric: rubric.data as Rubric };
}
