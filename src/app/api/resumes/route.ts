import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/errors";
import { getOwnedJob, handleDash } from "@/lib/http";
import { listResumeDTOs, storeResume, toResumeDTO, type ResumeDTO } from "@/lib/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILES = 10;

/** The HR's résumé library. ?jobId= (one job) · ?unlinked=1 (not on any candidate) · ?q= (name / file / résumé text). */
export function GET(req: Request) {
  return handleDash(req, async (user) => {
    const sp = new URL(req.url).searchParams;
    const q = sp.get("q")?.trim();
    const where: Prisma.ResumeWhereInput = {
      userId: user.id,
      ...(sp.get("jobId") ? { jobId: sp.get("jobId")! } : {}),
      ...(sp.get("unlinked") === "1" ? { candidateId: null } : {}),
      ...(q
        ? { OR: [{ fileName: { contains: q, mode: "insensitive" } }, { guessedName: { contains: q, mode: "insensitive" } }, { extractedText: { contains: q, mode: "insensitive" } }] }
        : {}),
    };
    return NextResponse.json({ resumes: await listResumeDTOs(where) });
  });
}

/**
 * Upload résumés into the library WITHOUT scoring (no LLM call, no extension). Optional `jobId` field attaches them to a job.
 * Score them later from the library ("Score against job") or by uploading from the job page.
 */
export function POST(req: Request) {
  return handleDash(req, async (user) => {
    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new HttpError(400, "Send the resumes as multipart/form-data");
    const form = await req.formData();
    const files = [...form.getAll("file"), ...form.getAll("files")].filter((f): f is File => f instanceof File);
    if (!files.length) throw new HttpError(400, "No files uploaded");
    if (files.length > MAX_FILES) throw new HttpError(400, `Upload at most ${MAX_FILES} files per request`);
    const jobIdRaw = form.get("jobId");
    const jobId = typeof jobIdRaw === "string" && jobIdRaw ? (await getOwnedJob(user.id, jobIdRaw)).job.id : null;

    const results: { fileName: string; ok: boolean; duplicate?: boolean; error?: string; resume?: ResumeDTO }[] = [];
    for (const file of files) {
      try {
        const r = await storeResume({ userId: user.id, file, jobId });
        results.push({ fileName: file.name, ok: true, duplicate: r.duplicate, resume: toResumeDTO(r.resume), error: r.textError ? `Stored, but no text could be read: ${r.textError}` : undefined });
      } catch (e) {
        results.push({ fileName: file.name, ok: false, error: e instanceof Error ? e.message : "Upload failed" });
      }
    }
    return NextResponse.json({ results });
  });
}
