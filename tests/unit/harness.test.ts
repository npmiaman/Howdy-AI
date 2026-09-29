import { describe, expect, it } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { fakeDb } from "../fakes/supabase";
import { postWebhook, roster, signup, table } from "../helpers";

describe("test harness", () => {
  it("drives signup → welcome → first reply through the real routes", async () => {
    roster(3);
    const res = await signup({ fullName: "Dana Client", email: "dana@client.co" });
    expect(res.status).toBe(200);
    const welcome = fakeMail.last("dana@client.co");
    expect(welcome?.subject).toBe("Welcome to Howdy, Dana");

    const hook = await postWebhook(
      fakeMail.inbound({ from: "dana@client.co", text: "I need a video editor", replyTo: welcome }),
    );
    expect(hook.status).toBe(200);
    expect(table("threads")).toHaveLength(1);
    expect(fakeMail.to("dana@client.co")).toHaveLength(2);
  });

  it("fake supabase parses or() expressions like PostgREST", async () => {
    fakeDb.rows("pending_matches").push(
      { id: "a", phase: "outreach", processed_at: "x", _seq: 1 },
      { id: "b", phase: "matching", processed_at: null, _seq: 2 },
      { id: "c", phase: "matching", processed_at: "x", _seq: 3 },
    );
    const { data } = await fakeDb
      .from("pending_matches")
      .select("*")
      .or("phase.eq.outreach,and(phase.eq.matching,processed_at.is.null)");
    expect((data as Array<{ id: string }>).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
