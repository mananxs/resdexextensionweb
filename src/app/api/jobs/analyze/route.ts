import { NextResponse } from "next/server";
import { z } from "zod";
import { extractRubric } from "@/lib/groq";
import { extractTextFromFile } from "@/lib/extractText";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ rawDescription: z.string().trim().min(40, "Paste a longer job description").max(30000) });

/**
 * Dashboard-only. Accepts either JSON { rawDescription } or multipart/form-data with a `file` (PDF/DOCX/TXT).
 * Returns { text, rubric } so the UI can auto-fill every field (all editable) before saving.
 */
export async function POST(req: Request) {
  try {
    let text: string;
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      text = (await extractTextFromFile(file)).slice(0, 30000);
    } else {
      text = Body.parse(await req.json()).rawDescription;
    }
    const rubric = await extractRubric(text);
    return NextResponse.json({ text, rubric });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    const status = (e as { status?: number }).status === 429 ? 429 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis failed" }, { status });
  }
}
