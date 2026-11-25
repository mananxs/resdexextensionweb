import { NextResponse } from "next/server";
import { handleDash } from "@/lib/http";
import { getOwnedResume } from "@/lib/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extracted text of a stored résumé — the in-browser viewer for DOCX (browsers can't render it) and a fallback for PDFs. */
export function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const r = await getOwnedResume(user.id, id);
    return NextResponse.json({ fileName: r.fileName, guessedName: r.guessedName, text: r.extractedText });
  });
}
