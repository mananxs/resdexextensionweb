import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth";
import { handleOpen } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleOpen(req, async () => {
    await endSession();
    return NextResponse.json({ ok: true });
  });
}
