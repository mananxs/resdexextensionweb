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
  } | null;
  status: "SHORTLISTED" | "CONTACTED" | "INTERVIEWING" | "OFFERED" | "REJECTED";
  /** "card" = saved from a Resdex search card (no CV view spent, no contact details, no deep audit yet). */
  profileLevel: "card" | "full";
  /** Original resume file is stored → GET /api/candidates/[id]/resume */
  resumeName: string | null;
  createdAt: string;
}

export const STATUSES = ["SHORTLISTED", "CONTACTED", "INTERVIEWING", "OFFERED", "REJECTED"] as const;
