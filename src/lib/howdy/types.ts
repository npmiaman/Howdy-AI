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
};

export type MatchResult = {
  freelancer: Freelancer;
  rationale: string;
  confidence: "high" | "medium" | "low";
};
