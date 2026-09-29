/** Memory write-back: what Howdy learns about a client carries to their next search. */
import { describe, expect, it } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { advance, DAY, HOUR, MIN, postWebhook, roster, runCron, signup, table } from "../helpers";

const CLIENT = "dana@client.co";
const say = (text: string) =>
  postWebhook(fakeMail.inbound({ from: CLIENT, text, replyTo: fakeMail.last(CLIENT) }));
const memories = () => table("memories").filter((m) => m.user_email === CLIENT).map((m) => String(m.fact));

describe("memory write-back", () => {
  it("saves durable facts when a brief completes, without duplicates", async () => {
    roster(3);
    await signup({ fullName: "Dana Client", email: CLIENT });
    await say("I need a video editor.");
    await say("A 60-second launch film for our fintech app, in 2 weeks, $60/hr.");
    expect(memories()).toEqual(
      expect.arrayContaining(["Has hired for: Video Editor.", "Budget for Video Editor: up to $60/hr.", "Industry: fintech."]),
    );
    const before = memories().length;
    const { remember, briefFacts } = await import("@/lib/howdy/memories");
    await remember(CLIENT, briefFacts({ role: "Video Editor", budget_usd_per_hour_max: 60, domain: "fintech" } as never));
    expect(memories()).toHaveLength(before);
  });

  it("remembers who a client didn't click with after the check-in", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await signup({ fullName: "Dana Client", email: CLIENT });
    await say("I need a video editor.");
    await say("A 60-second launch film for our fintech app, in 2 weeks, $60/hr.");
    advance(3 * HOUR + MIN);
    await runCron();
    for (const c of table("match_candidates").filter((x) => x.status === "invited")) {
      const email = String(table("freelancers").find((f) => f.id === c.freelancer_id)?.email);
      await postWebhook(fakeMail.inbound({ from: email, text: "Yes!", replyTo: fakeMail.last(email) }));
    }
    const shown = table("match_candidates").find((c) => c.shown_to_client_at)!;
    const name = String(table("freelancers").find((f) => f.id === shown.freelancer_id)?.name);
    await say(`${name.split(" ")[0]} please`);
    advance(6 * MIN);
    await runCron();
    advance(3 * DAY + MIN);
    await runCron();
    await say("It went badly, not a fit.");
    await say("Too corporate.");
    await say("Slow replies.");
    await say("That's it.");
    expect(memories().some((m) => m.startsWith(`Didn't click with ${name}:`) && m.includes("Too corporate"))).toBe(true);
  });
});
