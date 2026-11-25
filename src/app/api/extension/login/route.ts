import { NextRequest } from "next/server";
import { z } from "zod";
import { clearThrottle, throttle, verifyPassword } from "@/lib/auth";
import { HttpError, handlePublic, json, preflight } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });

/**
 * The extension's "Log in" form. Verifies the HR's email + password and hands back THEIR per-HR extension key, which the
 * extension then sends as the Bearer token on every call (all data access is scoped to that HR on the server).
 */
export function POST(req: NextRequest) {
  return handlePublic(async () => {
    const { email, password } = Body.parse(await req.json().catch(() => ({})));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
    throttle(`ext-login:${ip}:${email}`);
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !ok) throw new HttpError(401, "Wrong email or password");
    clearThrottle(`ext-login:${ip}:${email}`);
    return json({ apiKey: user.extensionApiKey, user: { id: user.id, email: user.email, name: user.name } });
  });
}
