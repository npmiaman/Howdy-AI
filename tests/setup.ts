/**
 * Global test wiring: every external service Howdy talks to is swapped for an
 * in-memory fake, and state is reset between tests. Nothing in the suite can
 * reach real Supabase, AgentMail, or Gemini — the env below is fake on purpose.
 */
import { afterEach, beforeEach, vi } from "vitest";

import { fakeMail } from "./fakes/agentmail";
import { fakeEmbedder, fakeLLM } from "./fakes/llm";
import { fakeDb } from "./fakes/supabase";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.AGENTMAIL_API_KEY = "fake-agentmail";
process.env.AGENTMAIL_INBOX_ID = "howdyai@agentmail.to";
process.env.GOOGLE_API_KEY = "fake-google";
process.env.CRON_SECRET = "test-cron-secret";
delete process.env.MIRROR_DATABASE_URL;
delete process.env.AGENTMAIL_WEBHOOK_SECRET;
delete process.env.HOWDY_OUTREACH_DRYRUN;
delete process.env.HOWDY_DRYRUN_ALLOWLIST;
delete process.env.VERCEL_ENV;

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseAdmin: () => fakeDb,
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/agentmail/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agentmail/client")>();
  return {
    ...actual,
    isAgentMailConfigured: () => true,
    getInboxId: async () => "howdyai@agentmail.to",
    sendFreshEmail: (a: Parameters<typeof fakeMail.sendFreshEmail>[0]) =>
      fakeMail.sendFreshEmail(a),
    replyToMessage: (a: Parameters<typeof fakeMail.replyToMessage>[0]) =>
      fakeMail.replyToMessage(a),
  };
});

vi.mock("@/lib/howdy/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/howdy/llm")>();
  return {
    ...actual,
    getChatModel: () => fakeLLM.model(),
    getEmbeddingModel: () => fakeEmbedder,
  };
});

// A fixed Tuesday, 10:00 UTC. Only Date is faked — real timers keep running so
// awaited I/O behaves normally.
export const T0 = new Date("2026-09-29T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  fakeDb.reset();
  fakeMail.reset();
  fakeLLM.reset();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.HOWDY_OUTREACH_DRYRUN;
  delete process.env.HOWDY_DRYRUN_ALLOWLIST;
  delete process.env.AGENTMAIL_WEBHOOK_SECRET;
  delete process.env.VERCEL_ENV;
});
