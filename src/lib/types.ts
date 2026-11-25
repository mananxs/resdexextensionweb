export interface CandidateDTO {
  id: string;
  jobId: string;
  fullName: string;
  currentRole: string | null;
  currentCompany: string | null;
  totalExp: number | null;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticePeriod: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  naukriProfileUrl: string | null;
  aiScore: number;
  aiTier: string;
  matchedSkills: string[];
  missingSkills: string[];
  aiVerdict: string;
  interviewQuestions: string[];
  audit: {
    strengths?: string[];
    risks?: string[];
    noticeFit?: string;
    noticeNote?: string;
    ctcFit?: string;
    ctcNote?: string;
    experienceNote?: string;
    checks?: { label: string; tier: string; level: number; evidence: string }[];
    flags?: string[];
    gaps?: string[];
    breakdown?: {
      rawScore: number;
      gates: string[];
      coverage: { must: number | null; important: number | null; nice: number | null };
      confidence: "high" | "medium" | "low";
    } | null;
  } | null;
  status: "SHORTLISTED" | "CONTACTED" | "INTERVIEWING" | "OFFERED" | "REJECTED";
  /** "card" = saved from a Resdex search card (no CV view spent, no contact details, no deep audit yet). */
  profileLevel: "card" | "full";
  /** Original resume file is stored → GET /api/candidates/[id]/resume (kept for older callers) */
  resumeName: string | null;
  /** Stored résumé (independent Resume table, or the legacy inline columns). View/download without the extension. */
  resume: { id: string | null; fileName: string; isPdf: boolean; viewUrl: string; downloadUrl: string; textUrl: string | null } | null;
  /** The job's rubric changed after this candidate was scored → the score may be out of date. */
  stale: boolean;
  createdAt: string;
}

export const STATUSES = ["SHORTLISTED", "CONTACTED", "INTERVIEWING", "OFFERED", "REJECTED"] as const;
