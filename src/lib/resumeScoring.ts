import type { Resume } from "@prisma/client";
import { upsertFullCandidate } from "./candidateUpsert";
import { CANDIDATE_RESUME_SELECT, toCandidateDTO } from "./dto";
import { prisma } from "./prisma";
import { HttpError } from "./errors";
import { auditProfile } from "./groq";
import { candidateKey, contentHash } from "./keys";
import { getCachedMany, putCache } from "./scoreCache";
import type { Audit, Rubric } from "./schemas";

/**
 * Scores ONE stored résumé against a job and upserts the Candidate (linking the Resume row).
 * Unchanged résumé + unchanged rubric → the cached audit is reused and the LLM is not called.
 */
export async function scoreStoredResume(args: {
  userId: string;
  jobId: string;
  rubric: Rubric;
  rubricHash: string;
  resume: Pick<Resume, "id" | "fileName" | "extractedText" | "guessedName">;
  force?: boolean;
}) {
  const text = args.resume.extractedText;
  if (text.length < 40) throw new HttpError(422, "No readable text in this file (scanned image?) — it can be viewed and downloaded but not scored");

  const key = candidateKey(text);
  const hash = contentHash(text);
  const cached = args.force ? undefined : (await getCachedMany({ userId: args.userId, jobId: args.jobId, rubricHash: args.rubricHash, kind: "deep", keys: [key] })).get(key);
  let audit: Audit & { tier?: string };
  let fromCache = false;
  if (cached && cached.contentHash === hash) {
    audit = cached.result as Audit;
    fromCache = true;
  } else {
    audit = await auditProfile(args.rubric, text);
    await putCache({
      userId: args.userId,
      jobId: args.jobId,
      rubricHash: args.rubricHash,
      kind: "deep",
      candidateKey: key,
      contentHash: hash,
      score: audit.score,
      result: audit,
      displayName: audit.extracted.fullName || args.resume.guessedName,
    });
  }

  const r = await upsertFullCandidate({
    userId: args.userId,
    jobId: args.jobId,
    audit,
    rawText: text,
    resumeId: args.resume.id,
    rubricHash: args.rubricHash,
    fallbackName: args.resume.guessedName || args.resume.fileName.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").trim(),
  });
  // reload with the résumé relation so the DTO carries view/download links
  const full = await prisma.candidate.findUniqueOrThrow({ where: { id: r.candidate.id }, omit: { resumeData: true }, include: CANDIDATE_RESUME_SELECT });
  return { ...r, fromCache, dto: toCandidateDTO(full, args.rubricHash) };
}
