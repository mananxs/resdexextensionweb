import type { Prisma, Resume } from "@prisma/client";
import { sha256 } from "./crypto";
import { HttpError } from "./errors";
import { extractTextFromBuffer, MAX_FILE_BYTES, RESUME_EXT, resumeMime } from "./extractText";
import { prisma } from "./prisma";
import { guessName } from "./textClean";

/**
 * Résumé storage, independent of the extension AND of scoring.
 * Bytes are kept in Postgres (bytea) — durable on Vercel (no writable disk), included in DB backups, and always read through an
 * ownership-checked route (`/api/resumes/[id]`), never a public URL.
 */

export interface ResumeDTO {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  guessedName: string | null;
  jobId: string | null;
  candidateId: string | null;
  hasText: boolean;
  createdAt: string;
  viewUrl: string; // inline (PDF) — DOCX falls back to the text view
  downloadUrl: string;
  textUrl: string;
}

export type ResumeMeta = Omit<Resume, "data" | "extractedText"> & { extractedText?: string };

export const toResumeDTO = (r: ResumeMeta & { hasText?: boolean }): ResumeDTO => ({
  id: r.id,
  fileName: r.fileName,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  guessedName: r.guessedName,
  jobId: r.jobId,
  candidateId: r.candidateId,
  hasText: r.hasText ?? (r.extractedText?.length ?? 0) > 0,
  createdAt: r.createdAt.toISOString(),
  viewUrl: `/api/resumes/${r.id}?inline=1`,
  downloadUrl: `/api/resumes/${r.id}`,
  textUrl: `/api/resumes/${r.id}/text`,
});

/** Columns safe for list queries (no file bytes, no full text). */
export const RESUME_LIST_OMIT = { data: true, extractedText: true } as const;

export interface StoreResult {
  resume: Resume;
  duplicate: boolean;
  /** Set when the file was stored but no text could be read (scanned PDF) — it can be viewed/downloaded but not scored. */
  textError?: string;
}

/**
 * Validates, extracts text and persists one uploaded file for this HR.
 * The same bytes uploaded twice by the same HR are stored once (unique on userId + sha256); re-uploading into a job attaches it.
 */
export async function storeResume(args: { userId: string; file: File; jobId?: string | null }): Promise<StoreResult> {
  const { file, userId } = args;
  if (!RESUME_EXT.test(file.name)) throw new HttpError(400, "Only PDF and DOCX resumes are supported");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "File is larger than 4 MB");
  if (file.size === 0) throw new HttpError(400, "File is empty");

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = resumeMime(file.name, file.type); // derived from the extension — the client-declared type is not trusted
  const sha = sha256(bytes);

  const existing = await prisma.resume.findUnique({ where: { userId_sha256: { userId, sha256: sha } } });
  if (existing) {
    const attach = args.jobId && !existing.jobId ? await prisma.resume.update({ where: { id: existing.id }, data: { jobId: args.jobId } }) : existing;
    return { resume: attach, duplicate: true };
  }

  let text = "";
  let textError: string | undefined;
  try {
    text = await extractTextFromBuffer(file.name, mime, bytes);
  } catch (e) {
    textError = e instanceof Error ? e.message : "Couldn't read text from the file";
  }
  const resume = await prisma.resume.create({
    data: {
      userId,
      jobId: args.jobId ?? null,
      fileName: file.name.slice(0, 200),
      mimeType: mime,
      sizeBytes: bytes.length,
      sha256: sha,
      extractedText: text,
      guessedName: text ? guessName(text) : null,
      data: new Uint8Array(bytes),
    },
  });
  return { resume, duplicate: false, textError };
}

export async function getOwnedResume(userId: string, id: string) {
  const r = await prisma.resume.findFirst({ where: { id, userId } });
  if (!r) throw new HttpError(404, "Resume not found");
  return r;
}

/** Library listing (metadata only — never the bytes or the full text). Used by /api/resumes and the server-rendered pages. */
export async function listResumeDTOs(where: Prisma.ResumeWhereInput, take = 200): Promise<ResumeDTO[]> {
  const rows = await prisma.resume.findMany({ where, orderBy: { createdAt: "desc" }, take, omit: RESUME_LIST_OMIT });
  if (!rows.length) return [];
  const withText = new Set((await prisma.resume.findMany({ where: { id: { in: rows.map((r) => r.id) }, NOT: { extractedText: "" } }, select: { id: true } })).map((r) => r.id));
  return rows.map((r) => toResumeDTO({ ...r, hasText: withText.has(r.id) }));
}
