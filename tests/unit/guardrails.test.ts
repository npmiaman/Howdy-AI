/** Anonymised pitches and the progress note. */
import { describe, expect, it } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { fakeLLM } from "../fakes/llm";
import { advance, HOUR, MIN, postWebhook, roster, runCron, table } from "../helpers";

const CLIENT = "dana@acmerobotics.com";

async function signupWithCompany() {
  const { POST } = await import("@/app/api/lead/route");
  await POST(
    new Request("http://localhost/api/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Dana Client", email: CLIENT, company: "Acme Robotics", position: "" }),
    }),
  );
}
const say = (text: string) => postWebhook(fakeMail.inbound({ from: CLIENT, text, replyTo: fakeMail.last(CLIENT) }));
const invites = () =>
  fakeMail.sent.filter((s) => /are you open to/i.test(s.subject)).map((s) => s.text);

describe("guardrails before sending", () => {
  it("a pitch that names the client falls back to fixed words", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await signupWithCompany();
    await say("I need a video editor.");
    await say("A 60-second launch film for Acme Robotics' new app, in 2 weeks, $60/hr.");
    fakeLLM.on("text", ({ system }) =>
      /reaching out to a vetted freelancer/i.test(system)
        ? "Hey! Acme Robotics needs a launch film. Keen?"
        : "ok",
    );
    advance(3 * HOUR + MIN);
    await runCron();
    const sent = invites();
    expect(sent).toHaveLength(3);
    for (const text of sent) {
      expect(text.toLowerCase()).not.toContain("acme");
      expect(text).toMatch(/quick one: are you open to a Video Editor gig/);
      expect(text).toMatch(/up to \$60\/hr/);
    }
  });

  it("a clean pitch is sent as written", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await signupWithCompany();
    await say("I need a video editor.");
    await say("A 60-second launch film for our new app, in 2 weeks, $60/hr.");
    fakeLLM.on("text", ({ system }) =>
      /reaching out to a vetted freelancer/i.test(system) ? "Quick one: open to a launch film gig?" : "ok",
    );
    advance(3 * HOUR + MIN);
    await runCron();
    for (const text of invites()) expect(text).toMatch(/^Quick one: open to a launch film gig\?/);
  });

  it("sends one honest progress note when recruiting runs past 8 hours", async () => {
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster(6);
    await signupWithCompany();
    await say("I need a video editor.");
    await say("A 60-second launch film for our new app, in 2 weeks, $60/hr.");
    advance(3 * HOUR + MIN);
    await runCron(); // outreach starts
    const email = String(
      table("freelancers").find((f) => f.id === table("match_candidates").find((c) => c.status === "invited")!.freelancer_id)?.email,
    );
    await postWebhook(fakeMail.inbound({ from: email, text: "Yes!", replyTo: fakeMail.last(email) }));

    advance(4 * HOUR); // ~7h in: too early
    await runCron();
    const notes = () => fakeMail.to(CLIENT).filter((s) => /Quick update/.test(s.text));
    expect(notes()).toHaveLength(0);

    advance(2 * HOUR); // ~9h in
    await runCron();
    await runCron();
    expect(notes()).toHaveLength(1);
    expect(notes()[0].text).toMatch(/1 of the creatives I reached out to has confirmed/);
    expect(notes()[0].text).toMatch(/within 1[0-9] hours/);
  });
});
