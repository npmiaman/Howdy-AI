/** Opt-outs: STOP means no more email from Howdy. */
import { describe, expect, it } from "vitest";

import { dispatch } from "@/lib/howdy/mailer";
import { isStopRequest } from "@/lib/howdy/suppression";

import { fakeMail } from "../fakes/agentmail";
import { advance, HOUR, MIN, postWebhook, roster, runCron, signup, table } from "../helpers";

const CLIENT = "dana@client.co";

async function clientSays(text: string) {
  return postWebhook(fakeMail.inbound({ from: CLIENT, text, replyTo: fakeMail.last(CLIENT) }));
}

function invited(): string[] {
  return table("match_candidates")
    .filter((c) => c.status === "invited")
    .map((c) => String(table("freelancers").find((f) => f.id === c.freelancer_id)?.email));
}

describe("opt-outs", () => {
  it.each([
    ["STOP", true],
    ["Stop.", true],
    ["unsubscribe", true],
    ["Please stop\n\nOn Tue, Howdy wrote: …", true],
    ["Can you stop by Friday?", false],
    ["Please don't stop sending gigs!", false],
    ["Yes I'm in", false],
  ])("isStopRequest(%j) → %s", (text, expected) => {
    expect(isStopRequest(text)).toBe(expected);
  });

  it("a freelancer who replies STOP to an invite declines, is confirmed, and is never emailed again", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await signup({ fullName: "Dana Client", email: CLIENT });
    await clientSays("I need a video editor");
    await clientSays("A 60-second launch film for our fintech app, in 2 weeks, $60/hr.");
    advance(3 * HOUR + MIN);
    await runCron();

    const [a] = invited();
    const invite = fakeMail.last(a)!;
    expect(invite.text).toMatch(/Reply STOP/);
    const res = await postWebhook(fakeMail.inbound({ from: a, text: "STOP", replyTo: invite }));
    expect(res.body.action).toBe("unsubscribed");
    expect(fakeMail.last(a)?.text).toMatch(/won't get any more emails/);
    expect(table("email_suppressions").map((r) => r.email)).toContain(a);
    const cand = table("match_candidates").find(
      (c) => table("freelancers").find((f) => f.id === c.freelancer_id)?.email === a,
    )!;
    expect(cand.status).toBe("declined");

    const sent = fakeMail.to(a).length;
    const out = await dispatch({ kind: "freelancer_invite", to: a, subject: "Another gig?", text: "…" });
    expect(out.delivered).toBe(false);
    expect(fakeMail.to(a)).toHaveLength(sent);
  });

  it("writing in again with a real message opts back in", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    expect((await clientSays("STOP")).body.action).toBe("unsubscribed");
    expect(table("email_suppressions")).toHaveLength(1);
    const res = await clientSays("Actually, I do need a video editor after all");
    expect(res.body.action).toBe("clarified");
    expect(table("email_suppressions")).toHaveLength(0);
  });

  it("nudges carry the opt-out line", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    await signup({ fullName: "Quiet Lead", email: "quiet@lead.co" });
    advance(49 * HOUR);
    await runCron();
    expect(fakeMail.last("quiet@lead.co")?.text).toMatch(/Reply STOP/);
  });
});
