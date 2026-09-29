/** Knowing when to hand over to a person, and asking two things at once. */
import { describe, expect, it } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { DEFAULT_HANDLERS, fakeLLM, type LlmCall } from "../fakes/llm";
import { advance, HOUR, MIN, postWebhook, roster, runCron, signup, table } from "../helpers";

const CLIENT = "dana@client.co";
const OPS = "amanpandit124421@gmail.com";

async function clientSays(text: string) {
  return postWebhook(fakeMail.inbound({ from: CLIENT, text, replyTo: fakeMail.last(CLIENT) }));
}
const thread = () => table("threads").find((t) => t.user_email === CLIENT)!;

describe("hand-over to a person", () => {
  it("mid-brief: an upset client gets a holding reply, the conversation pauses, the team is alerted", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    fakeLLM.on("assessment", (call: LlmCall) => ({
      ...(DEFAULT_HANDLERS.assessment(call) as object),
      needs_human: true,
      human_reason: "client is unhappy about last time",
    }));
    const res = await clientSays("Honestly the last person you sent was a disaster. I want to talk to someone.");
    expect(res.body.action).toBe("escalated");
    expect(fakeMail.last(CLIENT)?.text).toMatch(/looped them in/);
    expect(thread().ai_paused).toBe(true);
    const alert = fakeMail.last(OPS)!;
    expect(alert.subject).toMatch(/handed this conversation to you/);
    expect(alert.text).toMatch(/client is unhappy about last time/);
    // Howdy stays out from here on.
    expect((await clientSays("Hello?")).body.action).toBe("human_handled");
  });

  it("after a shortlist: a refund or pricing question goes to the team", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await signup({ fullName: "Dana Client", email: CLIENT });
    await clientSays("I need a video editor.");
    await clientSays("A 60-second launch film for our fintech app, in 2 weeks, $60/hr.");
    advance(3 * HOUR + MIN);
    await runCron();
    advance(17 * HOUR);
    await runCron(); // provisional shortlist
    const res = await clientSays("Before I pick anyone: can I get a refund on the fees if it doesn't work out?");
    expect(res.body.action).toBe("escalated");
    expect(fakeMail.last(CLIENT)?.text).toMatch(/looped them in/);
    expect(thread().ai_paused).toBe(true);
    expect(fakeMail.last(OPS)?.subject).toMatch(/handed dana@client\.co to you/);
  });

  it("the assessor is told to pair related questions and to flag hand-overs", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    await clientSays("I need a video editor");
    const call = fakeLLM.callsTo("assessment").at(-1)!;
    expect(call.system).toMatch(/cover both in one short message, never more than two/);
    expect(call.system).toMatch(/needs_human/);
    expect(call.system).toContain("How Howdy writes");
  });
});
