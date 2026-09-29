import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { DEFAULT_HANDLERS, fakeLLM, type LlmCall } from "../fakes/llm";
import { fakeDb } from "../fakes/supabase";
import { DAY, HOUR, MIN, advance, roster, runCron, table } from "../helpers";

const SESSION = "sess-web-1";
const EMAIL = "dana@client.co";
const OPENING = {
  role: "assistant",
  content: "Hey, I'm Howdy. Tell me what you're making and the creative you need — I'll start digging.",
};

type Msg = { role: "user" | "assistant"; content: string };
type ChatBody = {
  reply?: string;
  done?: boolean;
  needsContact?: boolean;
  error?: string;
};

async function postChat(
  body: Record<string, unknown>,
): Promise<{ status: number; body: ChatBody }> {
  const { POST } = await import("@/app/api/howdy/chat/route");
  const res = await POST(
    new Request("http://localhost/api/howdy/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as ChatBody };
}

/** A visitor session driven the way the widget drives it. */
function visitor(sessionId = SESSION) {
  const messages: Msg[] = [OPENING as Msg];
  return {
    messages,
    async say(content: string) {
      messages.push({ role: "user", content });
      const res = await postChat({ messages, sessionId });
      if (res.body.reply) messages.push({ role: "assistant", content: res.body.reply });
      return res;
    },
    contact(name: string, email: string) {
      return postChat({ messages, sessionId, contact: { name, email } });
    },
  };
}

/**
 * Readiness is controlled here, not by whatever rule assessBrief currently
 * uses: once the core fields (description, role, deadline, budget) are clear,
 * the assessment reports every field clear — ready under any rule. Until then
 * the default heuristic's missing fields keep the brief not-ready either way.
 */
const CORE = ["description", "role", "deadline", "budget_usd_per_hour_max"];
function readyOnceCoreFieldsAreClear() {
  fakeLLM.on("assessment", (call: LlmCall) => {
    const base = DEFAULT_HANDLERS.assessment(call) as {
      fields: Array<{ field: string; status: string; reason: string }>;
    };
    const coreClear = CORE.every(
      (f) => base.fields.find((x) => x.field === f)?.status === "clear",
    );
    if (!coreClear) return base;
    return {
      fields: base.fields.map((f) => ({ ...f, status: "clear" })),
      next_field: null,
      next_question: null,
    };
  });
}

/** Chat until the brief is ready; returns the session at the contact ask. */
async function readyVisitor() {
  const v = visitor();
  await v.say("I need a video editor");
  const ready = await v.say(
    "It's a launch film for our fintech app, $60/hr, in 2 weeks, senior",
  );
  expect(ready.body.needsContact).toBe(true);
  return v;
}

function webThread() {
  return table("threads").find((t) => t.gmail_thread_id === `web:${SESSION}`);
}

describe("website chat → email handoff", () => {
  beforeEach(() => {
    readyOnceCoreFieldsAreClear();
  });

  it("asks clarifying questions while the brief isn't ready, then asks for contact", async () => {
    const v = visitor();

    const first = await v.say("I need a video editor");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ reply: "Q:deadline?", done: false });

    const ready = await v.say(
      "It's a launch film for our fintech app, $60/hr, in 2 weeks, senior",
    );
    expect(ready.status).toBe(200);
    expect(ready.body.done).toBe(false);
    expect(ready.body.needsContact).toBe(true);
    expect(ready.body.reply).toMatch(/name/i);
    expect(ready.body.reply).toMatch(/email/i);
    expect(ready.body.reply).not.toMatch(/demo|trying you out|real thing|agentmail/i);

    // Nothing leaves the building until the visitor gives an email.
    expect(fakeMail.sent).toHaveLength(0);
    expect(table("pending_matches")).toHaveLength(0);
    expect(webThread()?.brief).toMatchObject({ role: "Video Editor", deadline: "2 weeks" });
  });

  it("refuses contact details before there's a brief", async () => {
    const v = visitor();
    await v.say("hi");
    const res = await v.contact("Dana Client", EMAIL);
    expect(res.status).toBe(409);
    expect(fakeMail.sent).toHaveLength(0);
    expect(table("pending_matches")).toHaveLength(0);
  });

  it("rejects an invalid email or missing name with a friendly 400, then accepts a fix", async () => {
    const v = await readyVisitor();

    const badEmail = await v.contact("Dana Client", "dana@client");
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toMatch(/email/i);

    const noName = await v.contact("   ", EMAIL);
    expect(noName.status).toBe(400);
    expect(noName.body.error).toMatch(/call you|name/i);

    expect(fakeMail.sent).toHaveLength(0);
    expect(table("leads")).toHaveLength(0);
    expect(table("pending_matches")).toHaveLength(0);

    // Validation failures don't burn the session's one handoff.
    const fixed = await v.contact("Dana Client", EMAIL);
    expect(fixed.status).toBe(200);
    expect(fixed.body.done).toBe(true);
  });

  it("hands a ready brief off to email: lead, handoff email, email thread, one scheduled match", async () => {
    const v = await readyVisitor();

    const res = await v.contact("Dana Client", ` ${EMAIL} `);
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(res.body.reply).toContain(EMAIL);
    expect(res.body.reply).toMatch(/24 hours/);

    // Lead captured, tagged as coming from the chat.
    const leads = table("leads");
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ email: EMAIL, full_name: "Dana Client", source: "web-chat" });

    // Exactly one handoff email, to the visitor.
    const mail = fakeMail.to(EMAIL);
    expect(mail).toHaveLength(1);
    expect(fakeMail.sent).toHaveLength(1);
    const handoff = mail[0];
    expect(handoff.subject).toBe("Your Howdy brief: Video Editor (29 Sep)");
    expect(handoff.text).toMatch(/^Hey Dana,/);
    expect(handoff.text).toContain("- Role: Video Editor");
    expect(handoff.text).toContain("- Deadline: 2 weeks");
    expect(handoff.text).toContain("- Budget: up to $60/hr");
    expect(handoff.text).toContain(
      "I'm on it — your shortlist lands in this thread within 24 hours. Reply here anytime to add details.",
    );
    expect(handoff.text.trimEnd().endsWith("Howdy")).toBe(true);

    // The email thread carries the whole chat, then the handoff email.
    const thread = table("threads").find((t) => t.gmail_thread_id === handoff.threadId);
    expect(thread).toMatchObject({
      user_email: EMAIL,
      subject: "Your Howdy brief: Video Editor (29 Sep)",
      brief: { role: "Video Editor", deadline: "2 weeks", budget_usd_per_hour_max: 60 },
    });
    const msgs = table("messages").filter((m) => m.thread_id === thread!.id);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["human", "I need a video editor"],
      ["ai", "Q:deadline?"],
      ["human", "It's a launch film for our fintech app, $60/hr, in 2 weeks, senior"],
      ["ai", v.messages[4].content],
      ["ai", handoff.text],
    ]);
    expect(msgs[4].gmail_message_id).toBe(handoff.messageId);

    // Exactly one match request, on the email thread.
    const pending = table("pending_matches");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      thread_id: thread!.id,
      user_email: EMAIL,
      subject: "Your Howdy brief: Video Editor (29 Sep)",
      processed_at: null,
      brief: { role: "Video Editor" },
    });

    expect(table("memories").map((m) => m.fact)).toContain("Name: Dana Client.");
    expect(webThread()?.last_processed_at).not.toBeNull();
  });

  it("doesn't double-send or double-schedule on a double-submit or a retry", async () => {
    const v = await readyVisitor();

    const [a, b] = await Promise.all([
      v.contact("Dana Client", EMAIL),
      v.contact("Dana Client", EMAIL),
    ]);
    const retry = await v.contact("Dana Client", EMAIL);

    for (const res of [a, b, retry]) {
      expect(res.status).toBe(200);
      expect(res.body.done).toBe(true);
    }
    expect(fakeMail.sent).toHaveLength(1);
    expect(table("pending_matches")).toHaveLength(1);
    expect(table("leads")).toHaveLength(1);
  });

  it("lets the visitor retry when the handoff email fails to send", async () => {
    const v = await readyVisitor();
    vi.spyOn(fakeMail, "sendFreshEmail").mockRejectedValueOnce(new Error("agentmail down"));

    const failed = await v.contact("Dana Client", EMAIL);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toBeTruthy();
    expect(table("pending_matches")).toHaveLength(0);

    const retried = await v.contact("Dana Client", EMAIL);
    expect(retried.status).toBe(200);
    expect(fakeMail.to(EMAIL)).toHaveLength(1);
    expect(table("pending_matches")).toHaveLength(1);
  });

  it("alerts ops, without re-sending, when scheduling fails after the email is out", async () => {
    const v = await readyVisitor();
    fakeDb.failNext("pending_matches", "insert");

    const res = await v.contact("Dana Client", EMAIL);
    // The visitor already has the email in their inbox — no error, no retry bait.
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(fakeMail.to(EMAIL)).toHaveLength(1);
    expect(table("pending_matches")).toHaveLength(0);

    const alert = fakeMail.sent.find((s) => /handoff incomplete/i.test(s.subject));
    expect(alert?.text).toMatch(/schedule match/);

    const retry = await v.contact("Dana Client", EMAIL);
    expect(retry.body.done).toBe(true);
    expect(fakeMail.to(EMAIL)).toHaveLength(1);
  });

  it("gets picked up by the cron like any emailed brief", async () => {
    const v = await readyVisitor();
    await v.contact("Dana Client", EMAIL);

    const [request] = table("pending_matches");
    advance(new Date(request.scheduled_at as string).getTime() - Date.now() + MIN);
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster();

    const cron = await runCron();
    expect(cron.status).toBe(200);

    expect(table("pending_matches")[0].processed_at).not.toBeNull();
    expect(
      table("match_candidates").filter((c) => c.request_id === request.id).length,
    ).toBeGreaterThan(0);
  });

  it("the shortlist lands in the handoff thread, not a new email", async () => {
    const v = await readyVisitor();
    await v.contact("Dana Client", EMAIL);
    const handoff = fakeMail.last(EMAIL)!;
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    roster();
    advance(3 * HOUR + MIN);
    await runCron(); // outreach starts
    advance(17 * HOUR);
    await runCron(); // nobody replied → 24h fallback shortlist
    const shortlist = fakeMail.last(EMAIL)!;
    expect(shortlist.text).toMatch(/top \d matches|strongest match/i);
    expect(shortlist.kind).toBe("reply");
    expect(shortlist.threadId).toBe(handoff.threadId);
  });

  it("a reply to the handoff email before recruiting starts is a status update, not a second match", async () => {
    const v = await readyVisitor();
    await v.contact("Dana Client", EMAIL);
    const { postWebhook } = await import("../helpers");
    const res = await postWebhook(
      fakeMail.inbound({ from: EMAIL, text: "Oh, and they should know After Effects", replyTo: fakeMail.last(EMAIL) }),
    );
    expect(res.body.action).toBe("status_update");
    expect(table("pending_matches")).toHaveLength(1);
  });

  it("a returning client's new brief starts its own conversation", async () => {
    const first = await readyVisitor();
    await first.contact("Dana Client", EMAIL);
    advance(2 * DAY);
    const second = visitor("sess-web-2");
    await second.say("I need a video editor");
    await second.say("It's a launch film for our fintech app, $60/hr, in 2 weeks, senior");
    await second.contact("Dana Client", EMAIL);
    const requests = table("pending_matches");
    expect(requests).toHaveLength(2);
    expect(requests[0].thread_id).not.toBe(requests[1].thread_id);
  });
});

