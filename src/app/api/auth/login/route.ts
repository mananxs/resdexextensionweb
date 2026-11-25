import { NextResponse } from "next/server";
import { z } from "zod";
import { clearThrottle, startSession, throttle, verifyPassword } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { handleOpen } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });

export function POST(req: Request) {
  return handleOpen(req, async () => {
    const { email, password } = Body.parse(await req.json().catch(() => ({})));
    const tk = `login:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?"}:${email}`;
    throttle(tk);
    const user = await prisma.user.findUnique({ where: { email } });
    // verifyPassword on a null hash is false; the same generic message avoids revealing which emails exist
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, "Wrong email or password");
    clearThrottle(tk);
    await startSession(user.id, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true });
  });
}
