import { NextResponse } from "next/server";
import { handleDash } from "@/lib/http";
import { llmStatus } from "@/lib/llmRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redacted health of the key pool this HR can use (own keys + shared). Key ids are short hashes — no secrets. Per server instance. */
export function GET(req: Request) {
  return handleDash(req, async () => NextResponse.json({ providers: llmStatus() }));
}
