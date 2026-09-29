/** The daily ops digest. */
import { describe, expect, it, vi } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { fakeDb } from "../fakes/supabase";
import { runCron, signup } from "../helpers";

const OPS = "amanpandit124421@gmail.com";
const digests = () => fakeMail.to(OPS).filter((s) => /daily digest/.test(s.subject));

describe("daily digest", () => {
  it("goes out once a day, after the morning hour, with the funnel and what needs attention", async () => {
    vi.setSystemTime(new Date("2026-09-29T00:30:00Z")); // before 01:00 UTC
    await signup({ fullName: "Dana Client", email: "dana@client.co" });
    await runCron();
    expect(digests()).toHaveLength(0);

    vi.setSystemTime(new Date("2026-09-29T01:15:00Z"));
    // A paused conversation where the client wrote last → waiting on the team.
    const t = fakeDb.rows("threads")[0];
    t.ai_paused = true;
    fakeDb.rows("messages").push({ id: "m1", thread_id: t.id, role: "human", content: "hello?", created_at: new Date().toISOString(), _seq: 99 });
    // A request stuck past 20h, and an intro not yet invoiced.
    fakeDb.rows("pending_matches").push({ id: "r1", user_email: "late@x.co", phase: "outreach", created_at: "2026-09-28T02:00:00Z", _seq: 100 });
    fakeDb.rows("billable_intros").push({ id: "b1", client_email: "paid@x.co", fee_usd: 50, invoiced_at: null, created_at: new Date().toISOString(), _seq: 101 });

    await Promise.all([runCron(), runCron()]);
    expect(digests()).toHaveLength(1);
    const text = digests()[0].text;
    expect(text).toMatch(/Sign-ups: 1/);
    expect(text).toMatch(/Waiting on you \(1\)/);
    expect(text).toContain("/api/howdy/takeover?");
    expect(text).toMatch(/late@x\.co — outreach/);
    expect(text).toMatch(/To invoice: 1 intro\(s\), \$50/);

    await runCron();
    expect(digests()).toHaveLength(1);
    vi.setSystemTime(new Date("2026-09-30T01:15:00Z"));
    await runCron();
    expect(digests()).toHaveLength(2);
  });
});
