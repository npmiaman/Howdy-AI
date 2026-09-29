import { z } from "zod";

export type Freelancer = {
  id: string;
  name: string;
  email: string;
  role: string;
  skills: string[];
  specialties: string[];
  rate_usd_per_hour: number;
  timezone: string;
  timezone_overlap_hours: string[];
  availability_hours_per_week: number;
  bio: string;
  portfolio_summary: string;
};

export const BriefSchema = z.object({
  role: z
    .string()
    .nullable()
    .describe(
      "The kind of freelancer needed, e.g. 'Video Editor', 'iOS Developer', 'Brand Designer'.",
    ),
  description: z
    .string()
    .nullable()
    .describe("Free-text project description in the user's own words."),
  stack_or_tools: z
    .array(z.string())
    .nullable()
    .describe(
      "Specific tools/tech needed, e.g. ['Premiere Pro', 'After Effects'] or ['Swift', 'SwiftUI'].",
    ),
  budget_usd_per_hour_max: z
    .number()
    .nullable()
    .describe("Max hourly rate in USD the user is willing to pay."),
  timezone_preference: z
    .string()
    .nullable()
    .describe(
      "Timezone overlap requirement, e.g. 'IST overlap', 'America/New_York'.",
    ),
  deadline: z
    .string()
    .nullable()
    .describe("Project deadline as free text, e.g. '2 weeks', 'next Friday'."),
  must_haves: z
    .array(z.string())
    .nullable()
    .describe("Hard requirements, e.g. 'shipped a Series A launch film'."),
  references: z
    .array(z.string())
    .nullable()
    .describe(
      "Style references the user mentioned, e.g. ['Linear', 'Apple'].",
    ),
  domain: z
    .string()
    .nullable()
    .describe(
      "The industry or domain the work sits in, e.g. 'fintech', 'consumer fashion', 'gaming', 'B2B SaaS'.",
    ),
  experience_level: z
    .enum(["junior", "mid", "senior", "lead"])
    .nullable()
    .describe(
      "Desired seniority of the freelancer: 'junior', 'mid', 'senior', or 'lead'. Infer from cues like budget and must-haves when the hirer doesn't say it outright.",
    ),
  red_flags: z
    .array(z.string())
    .nullable()
    .describe(
      "Dealbreakers or qualities the hirer wants to avoid, e.g. 'slow turnaround', 'overly corporate aesthetic', 'needs heavy hand-holding', 'unreliable communication'.",
    ),
  collaboration_style: z
    .string()
    .nullable()
    .describe(
      "The working style the hirer wants from the freelancer, e.g. 'proactive and self-directed', 'communicative and async-friendly', 'comfortable taking close art direction'.",
    ),
});

export type Brief = z.infer<typeof BriefSchema>;

export const EMPTY_BRIEF: Brief = {
  role: null,
  description: null,
  stack_or_tools: null,
  budget_usd_per_hour_max: null,
  timezone_preference: null,
  deadline: null,
  must_haves: null,
  references: null,
  domain: null,
  experience_level: null,
  red_flags: null,
  collaboration_style: null,
};

export type MatchResult = {
  freelancer: Freelancer;
  rationale: string;
  confidence: "high" | "medium" | "low";
};

// ---------------------------------------------------------------------------
// Field priority + "what a clear answer looks like" — the single source of
// truth for what Howdy collects, in the order it asks. Used by the assessor
// to judge each field and by the clarify step to pick what to ask next.
// ---------------------------------------------------------------------------
export type FieldSpec = {
  key: keyof Brief;
  label: string;
  clearWhen: string;
};

export const FIELD_PRIORITY: FieldSpec[] = [
  {
    key: "description",
    label: "Project description",
    clearWhen:
      "a concrete description of what they're making and why this work matters — not a one-liner like 'need a video'.",
  },
  {
    key: "role",
    label: "Role",
    clearWhen: "the specific kind of creative, e.g. 'brand designer', 'video editor'.",
  },
  {
    key: "deadline",
    label: "Deadline",
    clearWhen: "a concrete timeframe, e.g. '2 weeks', 'by March 1' — not 'soon' or 'flexible'.",
  },
  {
    key: "budget_usd_per_hour_max",
    label: "Budget",
    clearWhen: "a number or range they'll pay — not 'reasonable' or 'depends'.",
  },
  {
    key: "experience_level",
    label: "Experience level",
    clearWhen: "a clear seniority: junior, mid, senior, or lead.",
  },
  {
    key: "domain",
    label: "Domain / industry",
    clearWhen: "the industry the work sits in, e.g. 'fintech', 'fashion', 'gaming'.",
  },
  {
    key: "references",
    label: "Style references",
    clearWhen: "specific examples of work/brands they admire — not just 'modern' or 'clean'.",
  },
  {
    key: "red_flags",
    label: "Red flags / dealbreakers",
    clearWhen:
      "specific things to avoid, OR an explicit 'no dealbreakers' if they truly have none.",
  },
  {
    key: "collaboration_style",
    label: "Collaboration style",
    clearWhen:
      "how they want the freelancer to operate — proactive, communicative, takes close direction, etc.",
  },
  {
    key: "stack_or_tools",
    label: "Tools / stack",
    clearWhen: "the specific tools required, OR an explicit 'no preference' if any tool is fine.",
  },
  {
    key: "must_haves",
    label: "Must-haves",
    clearWhen:
      "hard requirements like 'shipped a launch film before', OR an explicit 'nothing specific'.",
  },
  {
    key: "timezone_preference",
    label: "Timezone overlap",
    clearWhen:
      "a timezone/overlap requirement, OR an explicit 'timezone doesn't matter'.",
  },
];

/**
 * The fields a brief needs before Howdy starts recruiting. Everything else in
 * FIELD_PRIORITY sharpens ranking when the client volunteers it, but isn't
 * worth another round-trip: with all twelve required, no real client ever
 * reached matching (see DECISIONS.md 2026-09-29).
 */
export const REQUIRED_FIELDS: (keyof Brief)[] = [
  "description",
  "role",
  "deadline",
  "budget_usd_per_hour_max",
];

export type FieldStatus = "clear" | "vague" | "missing" | "not_applicable";

export type FieldAssessment = {
  field: keyof Brief;
  status: FieldStatus;
  reason: string;
};

export type BriefAssessment = {
  fields: FieldAssessment[];
  allResolved: boolean;
  nextField: keyof Brief | null;
  nextQuestion: string | null;
};

// ---------------------------------------------------------------------------
// Freelancer outreach saga (see DECISIONS.md 2026-06-16).
// ---------------------------------------------------------------------------
export const SHORTLIST_TARGET = 3; // accepts needed before we go to the client
export const INITIAL_INVITES = 3; // freelancers invited up front
export const REPLY_TIMEOUT_HOURS = 6; // no-reply → pass to next-ranked (was 24; frequent cron cycles the roster fast so a confirmed shortlist can land well inside 24h)

// Hard guarantee: every actionable request gets a shortlist delivered to the
// client within 24h. If the recruit-then-confirm flow hasn't produced one by
// this many hours after the request came in, we deliver the best-ranked DB
// matches directly (flagged as still-being-confirmed — see clientShortlistEmail).
export const FALLBACK_DELIVERY_HOURS = 20;

// What we tell clients: a shortlist within this many hours of their request.
export const PROMISE_HOURS = 24;

// Don't resurrect ancient stalled requests with the fallback — only ones from
// the recent past that genuinely haven't been delivered.
export const FALLBACK_MAX_AGE_HOURS = 72;

// The "lazy match" defer never pushes outreach more than this far out, so the
// recruit flow + the 20h fallback both fit inside the 24h promise.
export const MAX_DEFER_HOURS = 3;

export type RequestPhase =
  | "matching"
  | "outreach"
  | "shortlist_sent"
  | "client_selected"
  | "connecting"
  | "connected"
  | "failed";

export type CandidateStatus =
  | "queued"
  | "invited"
  | "accepted"
  | "declined"
  | "timed_out"
  | "chosen"
  | "connecting"
  | "connected";

export type MatchCandidate = {
  id: string;
  requestId: string;
  threadId: string | null;
  freelancerId: string;
  rank: number;
  status: CandidateStatus;
  rationale: string | null;
  confidence: "high" | "medium" | "low" | null;
  outreachThreadId: string | null;
  outreachMessageId: string | null;
  invitedAt: Date | null;
  respondedAt: Date | null;
  /** When this candidate was put in front of the client (shortlist email). */
  shownToClientAt: Date | null;
};

/** A ranked candidate straight from the matcher, before persistence. */
export type RankedMatch = {
  freelancer: Freelancer;
  rank: number;
  score: number;
  rationale: string;
  confidence: "high" | "medium" | "low";
};

// ---------------------------------------------------------------------------
// Post-match experience (see DECISIONS.md 2026-06-16).
// ---------------------------------------------------------------------------
export const CHECKIN_DELAY_DAYS = 3; // first "how was the call?" after intro
export const MAX_DIGIN_TURNS = 3; // dig-in exchanges before we move on
export const MAX_CHECKIN_ROUND = 2; // initial call + one post-follow-up, then stop

export type CheckinParty = "company" | "freelancer";

export type CheckinStatus =
  | "scheduled"
  | "awaiting_reply"
  | "digging"
  | "offered_rematch"
  | "awaiting_followup"
  | "done";

export type CheckinSentiment = "good" | "bad";

export type PostMatchCheckin = {
  id: string;
  requestId: string;
  candidateId: string | null;
  party: CheckinParty;
  round: number;
  status: CheckinStatus;
  sentiment: CheckinSentiment | null;
  feedback: string | null;
  toEmail: string;
  checkinThreadId: string | null;
  checkinMessageId: string | null;
  turns: number;
  scheduledAt: Date;
  sentAt: Date | null;
};
