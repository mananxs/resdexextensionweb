import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, startSession, throttle, validatePassword } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { handleOpen } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
  inviteCode: z.string().max(200).optional(),
});

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Who may create an HR account:
 *  • SIGNUP_INVITE_CODE set  → the code is required (share it only with your HRs);
 *  • ALLOW_SIGNUP=true       → open sign-up;
 *  • neither                 → closed, EXCEPT the very first account on a fresh deployment (bootstrap admin).
 * A legacy single-tenant user (no password yet) can be claimed once by signing up with LEGACY_CLAIM_EMAIL / DEFAULT_USER_EMAIL.
 */
export function POST(req: Request) {
  return handleOpen(req, async () => {
    const b = Body.parse(await req.json().catch(() => ({})));
    throttle(`signup:${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?"}`, 6);
    const pwErr = validatePassword(b.password);
    if (pwErr) throw new HttpError(400, pwErr);

    const invite = process.env.SIGNUP_INVITE_CODE?.trim();
    const withPassword = await prisma.user.count({ where: { passwordHash: { not: null } } });
    if (invite) {
      if (!b.inviteCode || !same(b.inviteCode.trim(), invite)) throw new HttpError(403, "Invalid invite code");
    } else if (process.env.ALLOW_SIGNUP !== "true" && withPassword > 0) {
      throw new HttpError(403, "Sign-ups are closed. Ask your administrator for an invite code.");
    }

    const existing = await prisma.user.findUnique({ where: { email: b.email } });
    const legacyEmail = (process.env.LEGACY_CLAIM_EMAIL || process.env.DEFAULT_USER_EMAIL || "").trim().toLowerCase();
    let user;
    if (existing) {
      if (existing.passwordHash || !legacyEmail || existing.email !== legacyEmail) throw new HttpError(409, "An account with this email already exists — log in instead");
      user = await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(b.password), name: existing.name ?? b.name } });
    } else {
      user = await prisma.user.create({ data: { email: b.email, name: b.name, passwordHash: await hashPassword(b.password), extensionApiKey: generateApiKey() } });
    }
    await startSession(user.id, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true, user: { email: user.email, name: user.name } }, { status: 201 });
  });
}
