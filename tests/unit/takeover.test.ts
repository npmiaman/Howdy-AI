/** Human takeover: when the team replies by hand, Howdy steps back. */
import { describe, expect, it } from "vitest";

import { takeoverLink } from "@/lib/howdy/takeover";

import { fakeMail } from "../fakes/agentmail";
import { advance, HOUR, MIN, postWebhook, roster, runCron, signup, table } from "../helpers";

const CLIENT = "dana@client.co";
const OPS = "amanpandit124421@gmail.com";

async function clientSays(text: string) {
  return postWebhook(fakeMail.inbound({ from: CLIENT, text, replyTo: fakeMail.last(CLIENT) }));
}

async function openLink(url: string) {
  const { GET } = await import("@/app/api/howdy/takeover/route");
  return GET(new Request(url));
}

function thread() {
  return table("threads").find((t) => t.user_email === CLIENT)!;
}

describe("human takeover", () => {
  it("steps back once someone on the team replies by hand", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    expect((await clientSays("I need a video editor")).body.action).toBe("clarified");

    // Bernice answers Dana herself from Momo.
    const last = fakeMail.last(CLIENT)!;
    fakeMail.humanReply({ threadId: last.threadId, to: CLIENT, text: "Hi Dana, Bernice here — happy to help directly." });
    const sentBefore = fakeMail.to(CLIENT).length;

    const res = await clientSays("Thanks Bernice! Budget is $60/hr.");
    expect(res.body.action).toBe("human_handled");
    expect(fakeMail.to(CLIENT)).toHaveLength(sentBefore); // Howdy said nothing
    expect(thread().ai_paused).toBe(true);
    const alert = fakeMail.last(OPS)!;
    expect(alert.subject).toMatch(/reply needed/i);
    expect(alert.text).toContain("/api/howdy/takeover?");
  });

  it("the hand-back link puts Howdy back on the conversation", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    await clientSays("I need a video editor");
    fakeMail.humanReply({ threadId: fakeMail.last(CLIENT)!.threadId, to: CLIENT, text: "Manual reply" });
    await clientSays("ok");
    expect(thread().ai_paused).toBe(true);

    advance(MIN); // the hand-back comes after the team's reply
    const res = await openLink(takeoverLink(String(thread().id), "auto"));
    expect(res.status).toBe(200);
    expect(thread().ai_paused).toBe(false);
    // The team's earlier reply no longer counts; only new ones would.
    expect((await clientSays("Launch film, in 2 weeks, $60/hr")).body.action).not.toBe("human_handled");
  });

  it("rejects a tampered link", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    const good = takeoverLink(String(thread().id), "auto");
    const res = await openLink(good.replace(/sig=[0-9a-f]{4}/, "sig=0000"));
    expect(res.status).toBe(401);
  });

  it("the take-over link in a client alert pauses the conversation", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    await clientSays("I need a video editor");
    const alert = fakeMail.to(OPS).find((s) => /new client message/.test(s.subject))!;
    const link = alert.text.match(/https?:\/\/\S+takeover\S+/)![0];
    await openLink(link);
    expect((await clientSays("any update?")).body.action).toBe("human_handled");
  });

  it("holds client-facing saga email on a paused conversation and gives it to the team", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await signup({ fullName: "Dana Client", email: CLIENT });
    await clientSays("I need a video editor");
    await clientSays("A 60-second launch film for our fintech app, in 2 weeks, $60/hr.");
    advance(3 * HOUR + MIN);
    await runCron(); // outreach runs: freelancers are still invited
    await openLink(takeoverLink(String(thread().id), "human"));
    const before = fakeMail.to(CLIENT).length;
    advance(17 * HOUR);
    await runCron(); // 24h fallback shortlist → held
    expect(fakeMail.to(CLIENT)).toHaveLength(before);
    const held = fakeMail.to(OPS).find((s) => /held an email/.test(s.subject))!;
    expect(held.text).toMatch(/top \d matches|strongest match/);
  });

  it("never nudges a conversation the team is handling", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    await signup({ fullName: "Quiet Lead", email: "quiet@lead.co" });
    const t = table("threads").find((x) => x.user_email === "quiet@lead.co")!;
    await openLink(takeoverLink(String(t.id), "human"));
    advance(3 * 24 * HOUR);
    await runCron();
    expect(fakeMail.to("quiet@lead.co")).toHaveLength(1); // just the welcome
  });
});
