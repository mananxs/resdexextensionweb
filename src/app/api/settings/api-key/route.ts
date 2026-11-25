import { NextResponse } from "next/server";
import { handleDash } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/user";

export const dynamic = "force-dynamic";

/** Regenerate THIS HR's extension API key (invalidates the old one immediately — the extension must log in again). */
export function POST(req: Request) {
  return handleDash(req, async (user) => {
    const updated = await prisma.user.update({ where: { id: user.id }, data: { extensionApiKey: generateApiKey() } });
    return NextResponse.json({ apiKey: updated.extensionApiKey });
  });
}
