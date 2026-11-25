import type { Candidate } from "@prisma/client";
import type { CandidateDTO } from "./types";

type Row = Omit<Candidate, "resumeData"> & {
  resumes?: { id: string; fileName: string; mimeType: string }[];
  /** Lets the DTO know a legacy inline file exists without loading its bytes. */
  hasLegacyResume?: boolean;
};

/** Prisma row → client DTO. `auditJson === null` marks a card-level record (see lib/candidateUpsert.ts). */
export function toCandidateDTO(c: Row, currentRubricHash?: string | null): CandidateDTO {
  const r = c.resumes?.[0];
  const resume: CandidateDTO["resume"] = r
    ? { id: r.id, fileName: r.fileName, isPdf: r.mimeType === "application/pdf", viewUrl: `/api/resumes/${r.id}?inline=1`, downloadUrl: `/api/resumes/${r.id}`, textUrl: `/api/resumes/${r.id}/text` }
    : c.resumeName
      ? { id: null, fileName: c.resumeName, isPdf: c.resumeMime === "application/pdf", viewUrl: `/api/candidates/${c.id}/resume?inline=1`, downloadUrl: `/api/candidates/${c.id}/resume`, textUrl: null }
      : null;
  return {
    id: c.id,
    jobId: c.jobId,
    fullName: c.fullName,
    currentRole: c.currentRole,
    currentCompany: c.currentCompany,
    totalExp: c.totalExp,
    currentCtc: c.currentCtc,
    expectedCtc: c.expectedCtc,
    noticePeriod: c.noticePeriod,
    location: c.location,
    email: c.email,
    phone: c.phone,
    naukriProfileUrl: c.naukriProfileUrl,
    aiScore: c.aiScore,
    aiTier: c.aiTier,
    matchedSkills: c.matchedSkills,
    missingSkills: c.missingSkills,
    aiVerdict: c.aiVerdict,
    interviewQuestions: c.interviewQuestions,
    audit: (c.auditJson as CandidateDTO["audit"]) ?? null,
    status: c.status,
    resumeName: resume?.fileName ?? null,
    resume,
    stale: !!currentRubricHash && !!c.scoredRubricHash && c.scoredRubricHash !== currentRubricHash,
    profileLevel: c.auditJson === null ? "card" : "full",
    createdAt: c.createdAt.toISOString(),
  };
}

/** Prisma `select` for the résumé relation in candidate list queries — metadata only, never the bytes. */
export const CANDIDATE_RESUME_SELECT = {
  resumes: { orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true, fileName: true, mimeType: true } },
} as const;
