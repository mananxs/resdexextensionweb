import { NextResponse } from "next/server";
import { z } from "zod";
import { extractTextFromFile } from "@/lib/extractText";
import { extractRubric } from "@/lib/groq";
import { HttpError } from "@/lib/errors";
import { handleDash } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ rawDescription: z.string().trim().min(40, "Paste a longer job description").max(30000) });

/**
 * Dashboard-only. Accepts either JSON { rawDescription } or multipart/form-data with a `file` (PDF/DOCX/TXT).
 * Returns { text, rubric } so the UI can auto-fill every field (all editable) before saving.
 */
export function POST(req: Request) {
  return handleDash(req, async () => {
    let text: string;
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) throw new HttpError(400, "No file uploaded");
      text = (await extractTextFromFile(file)).slice(0, 30000);
    } else {
      text = Body.parse(await req.json()).rawDescription;
    }
    const rubric = await extractRubric(text);
    return NextResponse.json({ text, rubric });
  });
}
