import { randomBytes } from "crypto";
import { prisma } from "./prisma";

export function generateApiKey() {
  return `rsx_${randomBytes(24).toString("hex")}`;
}

/**
 * Dashboard identity. This build is single-tenant: one recruiter, resolved from env.
 * Replace with a session lookup (NextAuth/Clerk) to make the dashboard multi-user —
 * the extension API already authenticates per-user via the Bearer extensionApiKey.
 */
export async function getCurrentUser() {
  const email = process.env.DEFAULT_USER_EMAIL ?? "recruiter@example.com";
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: process.env.DEFAULT_USER_NAME ?? "Recruiter", extensionApiKey: generateApiKey() },
  });
}
