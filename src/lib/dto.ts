import type { Candidate } from "@prisma/client";
import type { CandidateDTO } from "./types";

/** Prisma row → client DTO. `auditJson === null` marks a card-level record (see lib/candidateUpsert.ts). */
export function toCandidateDTO(c: Omit<Candidate, "resumeData">): CandidateDTO {
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
    resumeName: c.resumeName,
    profileLevel: c.auditJson === null ? "card" : "full",
    createdAt: c.createdAt.toISOString(),
  };
}
