import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateApiKey, getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** Regenerate the extension API key (invalidates the old one immediately). */
export async function POST() {
  const user = await getCurrentUser();
  const updated = await prisma.user.update({ where: { id: user.id }, data: { extensionApiKey: generateApiKey() } });
  return NextResponse.json({ apiKey: updated.extensionApiKey });
}
