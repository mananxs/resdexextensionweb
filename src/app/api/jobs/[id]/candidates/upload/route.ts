import { NextResponse } from "next/server";
import { HttpError } from "@/lib/errors";
import { getOwnedJob, handleDash } from "@/lib/http";
import { defaultConcurrency, LlmError, mapWithConcurrency } from "@/lib/llmRouter";
import { prisma } from "@/lib/prisma";
import { scoreStoredResume } from "@/lib/resumeScoring";
import { storeResume, toResumeDTO, type ResumeDTO } from "@/lib/resumes";
import type { CandidateDTO } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Files are scored in parallel across the key pool, so a few per request fit the 60 s budget. */
const MAX_FILES_PER_REQUEST = 6;

export interface UploadFileResult {
  fileName: string;
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  upgradedFromCard?: boolean;
  /** true when the score came from the cache (same résumé + same rubric) — no LLM call was made. */
  cached?: boolean;
  /** The stored file (always present when the file was saved, even if scoring failed or was skipped). */
  resume?: ResumeDTO;
  candidate?: CandidateDTO;
}

/**
 * Dashboard-only (no extension, no Naukri access — files are résumés the recruiter already has).
 * multipart/form-data with `file` / `files` parts (PDF or DOCX) and optional `score=0` (store only):
 *   1. the file is ALWAYS stored first (Resume table) → it can be viewed/downloaded even if scoring fails;
 *   2. unless score=0, it is scored against the job (cache first, then LLM) and upserted as a Candidate linked to the stored file.
 */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleDash(req, async (user) => {
    const { id } = await ctx.params;
    const { job, rubric, rubricHash } = await getOwnedJob(user.id, id);

    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new HttpError(400, "Send the resumes as multipart/form-data");
    const form = await req.formData();
    const files = [...form.getAll("file"), ...form.getAll("files")].filter((f): f is File => f instanceof File);
    if (!files.length) throw new HttpError(400, "No files uploaded");
    if (files.length > MAX_FILES_PER_REQUEST) throw new HttpError(400, `Upload at most ${MAX_FILES_PER_REQUEST} files per request`);
    const scoreNow = form.get("score") !== "0";

    const settled = await mapWithConcurrency(files, defaultConcurrency(), async (file): Promise<UploadFileResult> => {
      const stored = await storeResume({ userId: user.id, file, jobId: job.id });
      const resume = toResumeDTO(stored.resume);
      if (!scoreNow) return { fileName: file.name, ok: true, duplicate: stored.duplicate, resume, error: stored.textError ? `Stored, but no text could be read: ${stored.textError}` : undefined };
      if (stored.textError) return { fileName: file.name, ok: false, resume, error: `Stored, but couldn't be scored: ${stored.textError}` };
      try {
        const r = await scoreStoredResume({ userId: user.id, jobId: job.id, rubric, rubricHash, resume: stored.resume });
        const fresh = await prisma.resume.findUnique({ where: { id: stored.resume.id }, omit: { data: true, extractedText: true } });
        return { fileName: file.name, ok: true, duplicate: r.duplicate, upgradedFromCard: r.upgradedFromCard, cached: r.fromCache, resume: fresh ? toResumeDTO(fresh) : resume, candidate: r.dto };
      } catch (e) {
        const msg = e instanceof LlmError && e.status === 429 ? `${e.message}` : e instanceof Error ? e.message : "Failed to score";
        return { fileName: file.name, ok: false, resume, error: `Stored, but scoring failed: ${msg}` };
      }
    });

    const results: UploadFileResult[] = settled.map((s, i) =>
      s.ok ? s.value : { fileName: files[i].name, ok: false, error: s.error instanceof Error ? s.error.message : "Failed to process file" },
    );
    return NextResponse.json({ results });
  });
}
