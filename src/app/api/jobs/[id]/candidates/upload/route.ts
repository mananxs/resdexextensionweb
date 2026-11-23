import { NextResponse } from "next/server";
import { auditProfile } from "@/lib/groq";
import { upsertFullCandidate } from "@/lib/candidateUpsert";
import { toCandidateDTO } from "@/lib/dto";
import { extractTextFromFile } from "@/lib/extractText";
import { getOwnedJob, HttpError } from "@/lib/http";
import { getCurrentUser } from "@/lib/user";
import type { CandidateDTO } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Each file costs one 120B audit (~10–20 s). The dashboard sends one file per request; this cap protects the 60 s budget. */
const MAX_FILES_PER_REQUEST = 3;
const ALLOWED = /\.(pdf|docx)$/i;

export interface UploadFileResult {
  fileName: string;
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  upgradedFromCard?: boolean;
  candidate?: CandidateDTO;
}

/**
 * Dashboard-only (no extension, no Naukri access — files are resumes the recruiter already has).
 * multipart/form-data with one or more `file` / `files` parts (PDF or DOCX) →
 * text extraction → deep audit against the job's rubric → dedupe/upsert with the same logic as /api/extension/import-candidate.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const { job, rubric } = await getOwnedJob(user.id, id);

    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new HttpError(400, "Send the resumes as multipart/form-data");
    const form = await req.formData();
    const files = [...form.getAll("file"), ...form.getAll("files")].filter((f): f is File => f instanceof File);
    if (!files.length) throw new HttpError(400, "No files uploaded");
    if (files.length > MAX_FILES_PER_REQUEST) throw new HttpError(400, `Upload at most ${MAX_FILES_PER_REQUEST} files per request`);

    const results: UploadFileResult[] = [];
    for (const file of files) {
      // Sequential on purpose: keeps us inside Groq rate limits and the function time budget.
      try {
        if (!ALLOWED.test(file.name)) throw new Error("Only PDF and DOCX resumes are supported");
        const text = await extractTextFromFile(file);
        const audit = await auditProfile(rubric, text);
        const r = await upsertFullCandidate({
          jobId: job.id,
          audit,
          rawText: text,
          resume: { name: file.name, mime: file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), data: new Uint8Array(await file.arrayBuffer()) },
          fallbackName: file.name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").trim(),
        });
        results.push({ fileName: file.name, ok: true, duplicate: r.duplicate, upgradedFromCard: r.upgradedFromCard, candidate: toCandidateDTO(r.candidate) });
      } catch (e) {
        const status = (e as { status?: number }).status;
        results.push({
          fileName: file.name,
          ok: false,
          error: status === 429 ? "Groq rate limit hit — retry in a few seconds" : e instanceof Error ? e.message : "Failed to process file",
        });
      }
    }
    return NextResponse.json({ results });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[upload]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
