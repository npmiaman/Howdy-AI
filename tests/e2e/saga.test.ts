/**
 * End-to-end: the whole Howdy flow through the real webhook + cron routes,
 * with Supabase / AgentMail / Gemini faked. Each test is a story a real
 * client or freelancer could live through.
 */
import { describe, expect, it } from "vitest";

import type { Sent } from "../fakes/agentmail";
import { fakeMail } from "../fakes/agentmail";
import { fakeLLM } from "../fakes/llm";
import {
  advance,
  DAY,
  HOUR,
  MIN,
  postWebhook,
  roster,
  runCron,
  signup,
  table,
} from "../helpers";

const CLIENT = "dana@client.co";
const FULL_BRIEF =
  "It's a 60-second launch film for our fintech app. Need it in 2 weeks, budget $60/hr.";

type Row = Record<string, unknown>;

function live() {
  process.env.HOWDY_OUTREACH_DRYRUN = "false";
}

/** Client replies to the latest email Howdy sent them. */
async function clientSays(text: string, email = CLIENT) {
  const last = fakeMail.last(email);
  if (!last) throw new Error(`no email to ${email} to reply to`);
  return postWebhook(fakeMail.inbound({ from: email, text, replyTo: last }));
}

async function freelancerSays(email: string, text: string) {
  const invite = fakeMail.last(email);
  if (!invite) throw new Error(`no email to ${email} to reply to`);
  return postWebhook(fakeMail.inbound({ from: email, text, replyTo: invite }));
}

function candidates(requestId?: string): Row[] {
  return table("match_candidates").filter((c) => !requestId || c.request_id === requestId);
}

function requests(): Row[] {
  return table("pending_matches");
}

function emailOf(freelancerId: unknown): string {
  const f = table("freelancers").find((r) => r.id === freelancerId);
  return String(f?.email);
}

function nameOf(freelancerId: unknown): string {
  const f = table("freelancers").find((r) => r.id === freelancerId);
  return String(f?.name);
}

function invitedEmails(requestId?: string): string[] {
  return candidates(requestId)
    .filter((c) => c.status === "invited")
    .sort((a, b) => Number(a.rank) - Number(b.rank))
    .map((c) => emailOf(c.freelancer_id));
}

function invitesTo(email: string): Sent[] {
  return fakeMail.to(email).filter((s) => /are you open to/i.test(s.subject));
}

/** Signup → vague first message → full brief. Leaves a scheduled request. */
async function briefToScheduled() {
  await signup({ fullName: "Dana Client", email: CLIENT });
  const first = await clientSays("Hey! I need a video editor.");
  expect(first.body.action).toBe("clarified");
  const second = await clientSays(FULL_BRIEF);
  expect(second.body.action).toBe("scheduled_match");
  expect(requests()).toHaveLength(1);
}

/** Advance past the lazy-match defer and let the cron start outreach. */
async function startOutreach() {
  advance(3 * HOUR + MIN);
  await runCron();
}

/** Three freelancers accept (one declines along the way) → shortlist sent. */
async function recruitShortlist(): Promise<Sent> {
  const [a, b, c] = invitedEmails();
  expect((await freelancerSays(a, "Yes, I'm in!")).body.action).toBe("freelancer_accepted");
  expect((await freelancerSays(b, "No, fully booked sorry")).body.action).toBe(
    "freelancer_declined",
  );
  expect((await freelancerSays(c, "Sure, sounds fun")).body.action).toBe("freelancer_accepted");
  // The decline refilled the pool with the next-ranked freelancer.
  const refill = invitedEmails().find((e) => ![a, b, c].includes(e));
  expect(refill).toBeTruthy();
  expect((await freelancerSays(refill!, "Yes, available")).body.action).toBe(
    "freelancer_accepted",
  );
  const shortlist = fakeMail.last(CLIENT)!;
  expect(requests()[0].phase).toBe("shortlist_sent");
  return shortlist;
}

function shownCandidates(requestId: unknown): Row[] {
  return candidates(String(requestId))
    .filter((c) => c.shown_to_client_at)
    .sort((a, b) => Number(a.rank) - Number(b.rank));
}

describe("happy path: brief → recruit → shortlist → intro → check-in → rematch", () => {
  it("runs the whole flow and every promise Howdy makes is backed by an action", async () => {
    live();
    roster(6);
    await briefToScheduled();
    await startOutreach();

    // 3 invites out, anonymized, nothing to the client yet.
    expect(invitedEmails()).toHaveLength(3);
    for (const e of invitedEmails()) {
      expect(invitesTo(e)).toHaveLength(1);
      expect(invitesTo(e)[0].text).not.toContain(CLIENT);
    }

    const shortlist = await recruitShortlist();
    const req = requests()[0];
    const shown = shownCandidates(req.id);
    expect(shown).toHaveLength(3);
    for (const c of shown) expect(shortlist.text).toContain(nameOf(c.freelancer_id));

    // Client picks the first one by name.
    const pickName = nameOf(shown[0].freelancer_id).split(" ")[0];
    const pick = await clientSays(`Let's go with ${pickName}`);
    expect(pick.body.action).toBe("client_selected");
    const chosenEmail = emailOf(shown[0].freelancer_id);
    expect(fakeMail.last(chosenEmail)?.subject).toMatch(/connecting you/i);
    expect(requests()[0].phase).toBe("connecting");

    // A few minutes later the intro goes out, CC'ing both.
    advance(6 * MIN);
    await runCron();
    const intro = fakeMail.last(CLIENT)!;
    expect(intro.subject).toMatch(/connecting you with/i);
    expect(intro.cc).toContain(chosenEmail);
    expect(requests()[0].phase).toBe("connected");

    // 3 days later, both sides get a check-in.
    advance(3 * DAY + MIN);
    await runCron();
    expect(fakeMail.last(CLIENT)?.subject).toMatch(/how was the call/i);
    expect(fakeMail.last(chosenEmail)?.subject).toMatch(/how was the call/i);

    // Client: it went badly → dig in → offered a rematch → yes.
    expect((await clientSays("Honestly it went badly, not a fit.")).body.stage).toBe(
      "digging_bad",
    );
    await clientSays("Their style was too corporate.");
    await clientSays("And they were slow to reply.");
    expect((await clientSays("That's about it.")).body.stage).toBe("offered_rematch");
    const tried = new Set(
      candidates()
        .filter((c) => c.status !== "queued")
        .map((c) => emailOf(c.freelancer_id)),
    );
    expect((await clientSays("Yes please, find someone else")).body.stage).toBe(
      "rematch_started",
    );

    // The rematch is a fresh request on the same conversation, recruiting
    // people who haven't been contacted — never the one it didn't work with.
    expect(requests()).toHaveLength(2);
    const rematch = requests().find((r) => r.id !== req.id)!;
    expect(rematch.thread_id).toBe(req.thread_id);
    expect(rematch.phase).toBe("outreach");
    const fresh = invitedEmails(String(rematch.id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const e of fresh) expect(tried.has(e)).toBe(false);
  });
});

describe("the brief gate lets real clients through", () => {
  it("schedules once description, role, deadline and budget are clear", async () => {
    roster(3);
    await briefToScheduled();
  });

  it("keeps asking while a core field is missing", async () => {
    roster(3);
    await signup({ fullName: "Dana Client", email: CLIENT });
    const res = await clientSays(
      "I need a video editor for a launch film for our fintech app, in 2 weeks.",
    );
    expect(res.body.action).toBe("clarified");
    expect(fakeMail.last(CLIENT)?.text).toBe("Q:budget_usd_per_hour_max?");
    expect(requests()).toHaveLength(0);
  });
});

describe("client replies are routed by where their request actually is", () => {
  it("a reply during recruiting gets a status update, not 'you already have a match'", async () => {
    live();
    roster(6);
    await briefToScheduled();
    await startOutreach();
    const res = await clientSays("Any update on this?");
    expect(res.body.action).toBe("status_update");
    expect(fakeLLM.calls.some((c) => /ALREADY sent them a match/.test(c.system))).toBe(false);
    expect(requests()).toHaveLength(1);
  });

  it("a reply before outreach starts is also a status update (no second request)", async () => {
    roster(6);
    await briefToScheduled();
    const res = await clientSays("Oh and they should know After Effects");
    expect(res.body.action).toBe("status_update");
    expect(requests()).toHaveLength(1);
  });

  it("'anyone else?' after the shortlist starts a real rematch", async () => {
    live();
    roster(8);
    await briefToScheduled();
    await startOutreach();
    await recruitShortlist();
    const shown = new Set(shownCandidates(requests()[0].id).map((c) => c.freelancer_id));

    const res = await clientSays("Hmm, none of these feel right. Anyone else?");
    expect(res.body.action).toBe("client_more_options");
    expect(requests()).toHaveLength(2);
    const rematch = requests()[1];
    const fresh = candidates(String(rematch.id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const c of fresh) expect(shown.has(c.freelancer_id)).toBe(false);
    expect(invitedEmails(String(rematch.id)).length).toBeGreaterThan(0);
  });

  it("'tell me more about #2' is answered without changing any state", async () => {
    live();
    roster(6);
    await briefToScheduled();
    await startOutreach();
    await recruitShortlist();
    const before = JSON.stringify([requests(), candidates()]);
    const res = await clientSays("Can you tell me more about #2? What's their portfolio like?");
    expect(res.body.action).toBe("client_question");
    expect(JSON.stringify([requests(), candidates()])).toBe(before);
    // The answer is grounded in the shortlisted profiles.
    const answerCall = fakeLLM.calls.filter((c) => c.name === "text").pop()!;
    const second = shownCandidates(requests()[0].id)[1];
    expect(answerCall.human).toContain(nameOf(second.freelancer_id));
  });

  it("a new project points them to a fresh email instead of promising nothing", async () => {
    live();
    roster(6);
    await briefToScheduled();
    await startOutreach();
    await recruitShortlist();
    const res = await clientSays("Also, we have a new project — we need a photographer too.");
    expect(res.body.action).toBe("client_new_project");
    expect(fakeMail.last(CLIENT)?.text).toMatch(/new email/i);
    expect(requests()).toHaveLength(1);
  });
});

describe("24h guarantee", () => {
  it("delivers a provisional shortlist once, even if two crons overlap, and confirms availability for real", async () => {
    live();
    roster(6);
    await briefToScheduled();
    await startOutreach();
    const firstInvites = invitedEmails();
    // Nobody replies. At 20h the fallback fires — twice, concurrently.
    advance(17 * HOUR);
    await Promise.all([runCron(), runCron()]);

    const shortlists = fakeMail.to(CLIENT).filter((s) => /top \d matches|strongest match/i.test(s.text));
    expect(shortlists).toHaveLength(1);
    const req = requests()[0];
    expect(req.phase).toBe("shortlist_sent");
    const shown = shownCandidates(req.id);
    expect(shown.length).toBeGreaterThan(0);
    // "I'm confirming their availability" must be true: everyone shown has an invite.
    for (const c of shown) expect(invitesTo(emailOf(c.freelancer_id)).length).toBe(1);
    expect(firstInvites.length).toBe(3);

    // Client picks one who hasn't confirmed yet → chosen, pending their yes.
    const pickName = nameOf(shown[0].freelancer_id).split(" ")[0];
    const pick = await clientSays(`${pickName} looks great`);
    expect(pick.body.action).toBe("client_selected");
    const picked = candidates().find((c) => c.id === shown[0].id)!;
    expect(picked.status).toBe("chosen");
    expect(fakeMail.last(CLIENT)?.text).toMatch(/checking|confirm/i);

    // The freelancer says yes → straight to connecting → intro.
    const email = emailOf(picked.freelancer_id);
    expect((await freelancerSays(email, "Yes! Happy to")).body.action).toBe("freelancer_accepted");
    expect(candidates().find((c) => c.id === picked.id)!.status).toBe("connecting");
    advance(6 * MIN);
    await runCron();
    expect(fakeMail.last(CLIENT)?.cc).toContain(email);
  });

  it("never shows the client someone who already declined", async () => {
    live();
    roster(3);
    await briefToScheduled();
    await startOutreach();
    const [a] = invitedEmails();
    await freelancerSays(a, "No thanks, not available");
    advance(17 * HOUR);
    await runCron();
    const shortlist = fakeMail.last(CLIENT)!;
    const declined = candidates().find((c) => c.status === "declined")!;
    expect(shortlist.text).not.toContain(nameOf(declined.freelancer_id));
  });
});

describe("concurrency", () => {
  it("two overlapping cron runs never invite the same freelancer twice", async () => {
    live();
    roster(6);
    await briefToScheduled();
    advance(3 * HOUR + MIN);
    await Promise.all([runCron(), runCron(), runCron()]);
    const all = table("freelancers").map((f) => invitesTo(String(f.email)).length);
    expect(all.filter((n) => n > 1)).toHaveLength(0);
    expect(all.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("dry-run is honest", () => {
  it("sends no saga email at all — including 'connecting you now'", async () => {
    roster(6);
    await briefToScheduled();
    await startOutreach();
    for (const f of table("freelancers")) expect(fakeMail.to(String(f.email))).toHaveLength(0);

    advance(17 * HOUR);
    await runCron(); // fallback "delivers" — logged only
    const beforePick = fakeMail.to(CLIENT).length;
    expect(requests()[0].phase).toBe("shortlist_sent");
    const shown = shownCandidates(requests()[0].id);
    await postWebhook(
      fakeMail.inbound({
        from: CLIENT,
        text: `${nameOf(shown[0].freelancer_id).split(" ")[0]} please`,
        replyTo: fakeMail.last(CLIENT),
      }),
    );
    expect(fakeMail.to(CLIENT)).toHaveLength(beforePick);
  });

  it("the allowlist lets the team test for real without emailing real freelancers", async () => {
    process.env.HOWDY_DRYRUN_ALLOWLIST = CLIENT;
    roster(6);
    await briefToScheduled();
    await startOutreach();
    for (const f of table("freelancers")) expect(fakeMail.to(String(f.email))).toHaveLength(0);
    advance(17 * HOUR);
    await runCron();
    expect(fakeMail.last(CLIENT)?.text).toMatch(/top \d matches|strongest match/i);
  });
});

describe("inbound guardrails", () => {
  it("a thread Howdy is only CC'd on gets no auto-reply (the Mitchell case)", async () => {
    const res = await postWebhook(
      fakeMail.inbound({
        from: "mitchell@agency.media",
        to: ["limbernice@bridgecreativesagency.com"],
        cc: ["howdyai@agentmail.to"],
        subject: "[For revision] logo and signage design",
        text: "Hey Bernice, following up on the logo iterations.",
      }),
    );
    expect(res.body.action).toBe("cc_only");
    expect(fakeMail.to("mitchell@agency.media")).toHaveLength(0);
    expect(fakeLLM.callsTo("brief")).toHaveLength(0);
  });

  it("the team's own emails are never answered as if they were a client", async () => {
    const res = await postWebhook(
      fakeMail.inbound({
        from: "limbernice@bridgecreativesagency.com",
        subject: "Re: logo",
        text: "Hi Mitchell, attached the updated designs.",
      }),
    );
    expect(res.body.action).toBe("team_sender");
    expect(fakeMail.to("limbernice@bridgecreativesagency.com").filter((s) => !/new (client|freelancer) message/.test(s.subject))).toHaveLength(0);
  });

  it("an empty message (attachments only) isn't fed to the agent", async () => {
    const res = await postWebhook(
      fakeMail.inbound({ from: CLIENT, subject: "files", text: "", extractedText: "" }),
    );
    expect(res.body.action).toBe("empty_body");
    expect(fakeLLM.callsTo("brief")).toHaveLength(0);
    expect(fakeMail.to(CLIENT)).toHaveLength(0);
  });

  it("falls back to the full text when extracted_text comes through empty", async () => {
    roster(3);
    const res = await postWebhook(
      fakeMail.inbound({
        from: CLIENT,
        subject: "Need an editor",
        text: "I need a video editor for our launch.\n\nOn Tue, Howdy wrote:\n> old stuff",
        extractedText: "",
      }),
    );
    expect(res.body.action).toBe("clarified");
    const stored = table("messages").find((m) => m.role === "human")!;
    expect(stored.content).toBe("I need a video editor for our launch.");
  });

  it("bounces and auto-replies are ignored", async () => {
    const res = await postWebhook(
      fakeMail.inbound({
        from: "mailer-daemon@amazonses.com",
        subject: "Delivery Status Notification (Failure)",
        text: "An error occurred while trying to deliver the mail",
      }),
    );
    expect(res.body.action).toBe("ignored_automated");
    expect(fakeMail.sent).toHaveLength(0);
  });
});

describe("freelancers emailing in", () => {
  it("a join request is acknowledged, pointed at the application form, and never treated as a brief", async () => {
    const res = await postWebhook(
      fakeMail.inbound({
        from: "newbie@portfolio.io",
        subject: "Request to join Howdy's freelancer roster",
        text: "Hi! I'm a motion designer, here's my reel.",
      }),
    );
    expect(res.body.action).toBe("freelancer_application");
    expect(fakeLLM.callsTo("brief")).toHaveLength(0);
    expect(fakeMail.last("newbie@portfolio.io")?.text).toMatch(/\/freelancers/);
  });

  it("a roster freelancer writing a fresh email isn't asked for a project budget", async () => {
    const [f] = roster(2);
    const res = await postWebhook(
      fakeMail.inbound({ from: f.email, subject: "Availability", text: "I'm free from next week!" }),
    );
    expect(res.body.action).toBe("freelancer_inbound");
    expect(fakeLLM.callsTo("brief")).toHaveLength(0);
  });

  it("routes a freelancer's yes even when the reply arrives on a new thread id", async () => {
    live();
    roster(6);
    await briefToScheduled();
    await startOutreach();
    fakeMail.splitThreads = true;
    const [a] = invitedEmails();
    expect((await freelancerSays(a, "Yes I'm in")).body.action).toBe("freelancer_accepted");
  });
});

describe("silent sign-ups", () => {
  it("nudges a sign-up who never replied, exactly once", async () => {
    live();
    await signup({ fullName: "Quiet Lead", email: "quiet@lead.co" });
    advance(47 * HOUR);
    await runCron();
    expect(fakeMail.to("quiet@lead.co")).toHaveLength(1);
    advance(2 * HOUR);
    await runCron();
    expect(fakeMail.to("quiet@lead.co")).toHaveLength(2);
    expect(fakeMail.last("quiet@lead.co")?.text).toMatch(/Quiet/);
    advance(3 * DAY);
    await runCron();
    expect(fakeMail.to("quiet@lead.co")).toHaveLength(2);
  });

  it("never nudges old sign-ups or anyone who already replied", async () => {
    live();
    await signup({ fullName: "Old Lead", email: "old@lead.co" });
    advance(20 * DAY);
    await signup({ fullName: "Chatty Lead", email: "chatty@lead.co" });
    await postWebhook(
      fakeMail.inbound({ from: "chatty@lead.co", text: "I need a video editor", replyTo: fakeMail.last("chatty@lead.co") }),
    );
    const chattyBefore = fakeMail.to("chatty@lead.co").length;
    advance(3 * DAY);
    await runCron();
    expect(fakeMail.to("old@lead.co")).toHaveLength(1);
    expect(fakeMail.to("chatty@lead.co")).toHaveLength(chattyBefore);
  });

  it("dry-run doesn't nudge", async () => {
    await signup({ fullName: "Quiet Lead", email: "quiet@lead.co" });
    advance(3 * DAY);
    await runCron();
    expect(fakeMail.to("quiet@lead.co")).toHaveLength(1);
  });
});
