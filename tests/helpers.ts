/** Shared helpers for driving Howdy's real route handlers in tests. */
import { vi } from "vitest";

import { freelancerToEmbeddingText } from "@/lib/howdy/data";
import type { Freelancer } from "@/lib/howdy/types";

import { fakeEmbed } from "./fakes/llm";
import { fakeDb } from "./fakes/supabase";

export const HOUR = 60 * 60 * 1000;
export const MIN = 60 * 1000;
export const DAY = 24 * HOUR;

export function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

let n = 0;
export function freelancer(over: Partial<Freelancer> = {}): Freelancer {
  n += 1;
  return {
    id: `fl-${n}`,
    name: `Freelancer${n} Test`,
    email: `freelancer${n}@example.com`,
    role: "Video Editor",
    skills: ["Premiere Pro", "After Effects"],
    specialties: ["product launch videos"],
    rate_usd_per_hour: 50,
    timezone: "Asia/Singapore",
    timezone_overlap_hours: ["SGT"],
    availability_hours_per_week: 20,
    bio: "Video editor for consumer brands.",
    portfolio_summary: "Launch films and social cuts.",
    ...over,
  };
}

/** Insert freelancers into the fake DB with embeddings, like the seed script. */
export function seedFreelancers(list: Freelancer[]): Freelancer[] {
  for (const f of list) {
    fakeDb.rows("freelancers").push({
      ...f,
      embedding: JSON.stringify(fakeEmbed(freelancerToEmbeddingText(f))),
      _seq: 0,
    });
  }
  return list;
}

/** A roster of n distinct video editors. */
export function roster(count = 6): Freelancer[] {
  return seedFreelancers(
    Array.from({ length: count }, (_, i) =>
      freelancer({ name: ["Maya", "Omar", "Priya", "Jonas", "Lena", "Kofi", "Ines", "Tariq"][i % 8] + ` Editor${i}` }),
    ),
  );
}

export async function postWebhook(
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/agentmail/webhook/route");
  const res = await POST(
    new Request("http://localhost/api/agentmail/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export async function runCron(): Promise<{ status: number; body: Record<string, unknown> }> {
  const { GET } = await import("@/app/api/howdy/process-pending/route");
  const res = await GET(
    new Request("http://localhost/api/howdy/process-pending", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export async function signup(args: { fullName: string; email: string; company?: string }) {
  const { POST } = await import("@/app/api/lead/route");
  const res = await POST(
    new Request("http://localhost/api/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: "", position: "", ...args }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export function table(name: string): Record<string, unknown>[] {
  return fakeDb.rows(name);
}
