/** Edge cases around the saga that the end-to-end stories don't reach. */
import { describe, expect, it } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { fakeLLM } from "../fakes/llm";
import { fakeDb } from "../fakes/supabase";
import { advance, DAY, freelancer, HOUR, MIN, postWebhook, roster, runCron, seedFreelancers, signup, table } from "../helpers";

const CLIENT = "dana@client.co";
const OPS = "amanpandit124421@gmail.com";

async function clientSays(text: string) {
  return postWebhook(fakeMail.inbound({ from: CLIENT, text, replyTo: fakeMail.last(CLIENT) }));
}

async function scheduled() {
  await signup({ fullName: "Dana Client", email: CLIENT });
  await clientSays("I need a video editor.");
  const res = await clientSays("A 60-second launch film for our fintech app, in 2 weeks, $60/hr.");
  expect(res.body.action).toBe("scheduled_match");
}

function invited(): string[] {
  return table("match_candidates")
    .filter((c) => c.status === "invited")
    .map((c) => String(table("freelancers").find((f) => f.id === c.freelancer_id)?.email));
}

describe("saga edges", () => {
  it("a webhook delivered twice is handled once", async () => {
    await signup({ fullName: "Dana Client", email: CLIENT });
    const p = fakeMail.inbound({ from: CLIENT, text: "I need a video editor", replyTo: fakeMail.last(CLIENT) });
    expect((await postWebhook(p)).body.action).toBe("clarified");
    expect((await postWebhook(p)).body.action).toBe("duplicate");
    expect(fakeMail.to(CLIENT)).toHaveLength(2); // welcome + one clarifying question
  });

  it("stops clarifying after the turn cap and matches with what it has", async () => {
    roster(3);
    await signup({ fullName: "Dana Client", email: CLIENT });
    let action = "";
    for (let i = 0; i < 8 && action !== "scheduled_match"; i++) {
      action = String((await clientSays("I need a video editor, not sure about the rest")).body.action);
    }
    expect(action).toBe("scheduled_match");
    expect(fakeMail.to(CLIENT).length).toBeLessThanOrEqual(7);
  });

  it("a failed outreach start is released and retried without duplicates", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await scheduled();
    advance(3 * HOUR + MIN);
    fakeDb.failNext("match_candidates", "upsert");
    const first = await runCron();
    expect(JSON.stringify(first.body)).toContain("error_start");
    expect(table("pending_matches")[0].processed_at).toBeNull();
    await runCron();
    expect(invited()).toHaveLength(3);
    expect(new Set(table("match_candidates").map((c) => c.freelancer_id)).size).toBe(
      table("match_candidates").length,
    );
  });

  it("when nobody fits, the client is told honestly and the request closes", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    seedFreelancers([freelancer({ rate_usd_per_hour: 500 })]); // way over budget
    await scheduled();
    advance(3 * HOUR + MIN);
    await runCron();
    expect(table("pending_matches")[0].phase).toBe("failed");
    expect(fakeMail.last(CLIENT)?.text).toMatch(/loosen one thing/i);
    // Their next reply starts a fresh search instead of a status update.
    const res = await clientSays("OK, budget can go up to $600/hr");
    expect(res.body.action).toBe("scheduled_match");
    expect(table("pending_matches")).toHaveLength(2);
  });

  it("a chosen freelancer who backs out: the client hears about it and can pick again", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await scheduled();
    advance(3 * HOUR + MIN);
    await runCron();
    advance(17 * HOUR); // nobody replied → provisional shortlist
    await runCron();
    const shown = table("match_candidates")
      .filter((c) => c.shown_to_client_at)
      .sort((a, b) => Number(a.rank) - Number(b.rank));
    const f = table("freelancers").find((x) => x.id === shown[0].freelancer_id)!;
    await clientSays(`${String(f.name).split(" ")[0]} please`);
    expect(table("pending_matches")[0].phase).toBe("client_selected");

    const res = await postWebhook(
      fakeMail.inbound({ from: String(f.email), text: "Sorry, no — I'm booked", replyTo: fakeMail.last(String(f.email)) }),
    );
    expect(res.body.action).toBe("freelancer_declined");
    expect(fakeMail.last(CLIENT)?.text).toMatch(/can't take this one on/i);
    expect(table("pending_matches")[0].phase).toBe("shortlist_sent");
  });

  it("an unclear freelancer reply gets a yes/no follow-up, not a decision", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await scheduled();
    advance(3 * HOUR + MIN);
    await runCron();
    const [a] = invited();
    const res = await postWebhook(
      fakeMail.inbound({ from: a, text: "What's the budget exactly?", replyTo: fakeMail.last(a) }),
    );
    expect(res.body.action).toBe("freelancer_unclear");
    expect(fakeMail.last(a)?.text).toMatch(/yes or no/i);
    expect(invited()).toContain(a);
  });

  it("a freelancer's bad call goes to the team, never a client rematch", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await scheduled();
    advance(3 * HOUR + MIN);
    await runCron();
    for (const e of invited()) {
      await postWebhook(fakeMail.inbound({ from: e, text: "Yes!", replyTo: fakeMail.last(e) }));
    }
    const shown = table("match_candidates").find((c) => c.shown_to_client_at)!;
    const f = table("freelancers").find((x) => x.id === shown.freelancer_id)!;
    await clientSays(`${String(f.name).split(" ")[0]} please`);
    advance(6 * MIN);
    await runCron();
    advance(3 * DAY + MIN);
    await runCron();

    const say = (text: string) =>
      postWebhook(fakeMail.inbound({ from: String(f.email), text, replyTo: fakeMail.last(String(f.email)) }));
    expect((await say("It went badly honestly")).body.stage).toBe("digging_bad");
    await say("They kept changing the scope");
    await say("And didn't answer for days");
    expect((await say("That's all")).body.stage).toBe("done_bad");
    expect(table("pending_matches")).toHaveLength(1);
    expect(fakeMail.last(OPS)?.subject).toMatch(/bad call/i);
  });

  it("an applicant replying to their confirmation isn't asked for a budget", async () => {
    fakeDb.rows("freelancer_applications").push({
      id: "app-1",
      email: "newbie@portfolio.io",
      status: "pending",
      _seq: 0,
    });
    const res = await postWebhook(
      fakeMail.inbound({ from: "newbie@portfolio.io", subject: "Re: Got your application, Nia", text: "Thanks! Also here's my reel." }),
    );
    expect(res.body.action).toBe("freelancer_applicant");
    expect(fakeLLM.callsTo("brief")).toHaveLength(0);
  });

  it("the cron stops loudly, touching nothing, if migration 0006 isn't applied", async () => {
    roster(3);
    await scheduled();
    advance(3 * HOUR + MIN);
    fakeDb.failNext("match_candidates", "select");
    const res = await runCron();
    expect(res.status).toBe(500);
    expect(String(res.body.error)).toMatch(/0006/);
    expect(table("pending_matches")[0].processed_at).toBeNull();
  });

  it("a start that died mid-way (claim left behind) is picked up once the claim expires", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await scheduled();
    advance(3 * HOUR + MIN);
    const { claimPending } = await import("@/lib/howdy/scheduler");
    expect(await claimPending(String(table("pending_matches")[0].id))).toBe(true); // …then "killed"
    await runCron();
    expect(invited()).toHaveLength(0); // claim still fresh: left alone
    advance(11 * MIN);
    await runCron();
    expect(invited()).toHaveLength(3);
  });

  it("an intro send that died mid-way goes out once its claim expires", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await scheduled();
    advance(3 * HOUR + MIN);
    await runCron();
    for (const e of invited()) {
      await postWebhook(fakeMail.inbound({ from: e, text: "Yes!", replyTo: fakeMail.last(e) }));
    }
    const shown = table("match_candidates").find((c) => c.shown_to_client_at)!;
    const f = table("freelancers").find((x) => x.id === shown.freelancer_id)!;
    await clientSays(`${String(f.name).split(" ")[0]} please`);
    advance(6 * MIN);
    const { claimConnect } = await import("@/lib/howdy/scheduler");
    expect(await claimConnect(String(table("pending_matches")[0].id))).toBe(true); // …then "killed"
    await runCron();
    expect(table("pending_matches")[0].phase).toBe("connecting");
    advance(11 * MIN);
    await runCron();
    expect(table("pending_matches")[0].phase).toBe("connected");
    expect(fakeMail.last(CLIENT)?.cc).toContain(String(f.email));
  });

  it("a hung model call ends in a 504 and an ops alert, not a silent kill", async () => {
    process.env.HOWDY_WEBHOOK_DEADLINE_MS = "50";
    fakeLLM.on("brief", () => new Promise(() => {}));
    const res = await postWebhook(fakeMail.inbound({ from: CLIENT, subject: "Hi", text: "I need a video editor" }));
    delete process.env.HOWDY_WEBHOOK_DEADLINE_MS;
    expect(res.status).toBe(504);
    expect(fakeMail.last(OPS)?.subject).toMatch(/ran out of time/i);
  });

  it("a third yes while the 24h fallback is mid-send doesn't send a second shortlist", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await scheduled();
    advance(3 * HOUR + MIN);
    await runCron();
    const [a, b, c] = invited();
    for (const e of [a, b])
      await postWebhook(fakeMail.inbound({ from: e, text: "Yes!", replyTo: fakeMail.last(e) }));
    const { claimShortlist } = await import("@/lib/howdy/scheduler");
    expect(await claimShortlist(String(table("pending_matches")[0].id))).toBe(true); // fallback in flight
    const before = fakeMail.to(CLIENT).length;
    const res = await postWebhook(fakeMail.inbound({ from: c, text: "Yes!", replyTo: fakeMail.last(c) }));
    expect(res.body.action).toBe("freelancer_accepted");
    expect(res.body.shortlistReady).toBe(false);
    expect(fakeMail.to(CLIENT)).toHaveLength(before);
  });
});

