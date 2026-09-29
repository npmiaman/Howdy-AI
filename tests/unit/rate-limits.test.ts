/** Rate limits and the daily AI budget on every public entry point. */
import { describe, expect, it } from "vitest";

import { fakeMail } from "../fakes/agentmail";
import { fakeLLM } from "../fakes/llm";
import { advance, HOUR, postWebhook, signup } from "../helpers";

const OPS = "amanpandit124421@gmail.com";

async function chat(sessionId: string, content: string, ip = "1.2.3.4") {
  const { POST } = await import("@/app/api/howdy/chat/route");
  const res = await POST(
    new Request("http://localhost/api/howdy/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ sessionId, messages: [{ role: "user", content }] }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { reply?: string; error?: string } };
}

async function signupFrom(ip: string, email: string) {
  const { POST } = await import("@/app/api/lead/route");
  const res = await POST(
    new Request("http://localhost/api/lead", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ fullName: "Test Lead", email, company: "", position: "" }),
    }),
  );
  return res.status;
}

describe("rate limits", () => {
  it("caps chat messages per session, without affecting other visitors", async () => {
    process.env.HOWDY_CHAT_PER_SESSION = "3";
    for (let i = 0; i < 3; i++) expect((await chat("s1", `hi ${i}`)).status).toBe(200);
    const blocked = await chat("s1", "one more");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/howdyai@agentmail\.to/);
    expect((await chat("s2", "hello", "5.6.7.8")).status).toBe(200);
    delete process.env.HOWDY_CHAT_PER_SESSION;
  });

  it("caps chat messages per IP across sessions", async () => {
    process.env.HOWDY_CHAT_PER_IP_HOUR = "2";
    expect((await chat("a", "hi")).status).toBe(200);
    expect((await chat("b", "hi")).status).toBe(200);
    expect((await chat("c", "hi")).status).toBe(429);
    advance(HOUR + 1000);
    expect((await chat("d", "hi")).status).toBe(200); // new window
    delete process.env.HOWDY_CHAT_PER_IP_HOUR;
  });

  it("caps form submissions per IP", async () => {
    for (let i = 0; i < 5; i++) expect(await signupFrom("9.9.9.9", `lead${i}@x.co`)).toBe(200);
    expect(await signupFrom("9.9.9.9", "lead6@x.co")).toBe(429);
    expect(await signupFrom("8.8.8.8", "other@x.co")).toBe(200);
  });

  it("stops AI work once the daily budget is spent, and tells the team once", async () => {
    process.env.HOWDY_DAILY_AI_TURNS = "2";
    expect((await chat("a", "hi", "1.1.1.1")).status).toBe(200);
    expect((await chat("b", "hi", "2.2.2.2")).status).toBe(200);
    const llmCalls = fakeLLM.calls.length;
    const out = await chat("c", "hi", "3.3.3.3");
    expect(out.status).toBe(429);
    expect(fakeLLM.calls.length).toBe(llmCalls); // no AI spent on the blocked turn
    // Inbound email falls back to the team too.
    await signup({ fullName: "Dana Client", email: "dana@client.co" });
    const res = await postWebhook(
      fakeMail.inbound({ from: "dana@client.co", text: "I need a video editor", replyTo: fakeMail.last("dana@client.co") }),
    );
    expect(res.body.action).toBe("ai_budget_exhausted");
    expect(fakeMail.to(OPS).filter((s) => /hit today's AI budget/.test(s.subject))).toHaveLength(1);
    delete process.env.HOWDY_DAILY_AI_TURNS;
  });

  it("rate-limits a sender flooding the inbox", async () => {
    process.env.HOWDY_INBOUND_PER_SENDER_HOUR = "2";
    const send = (i: number) =>
      postWebhook(fakeMail.inbound({ from: "flood@x.co", subject: `Need help ${i}`, text: "I need a video editor" }));
    expect((await send(1)).body.action).not.toBe("rate_limited");
    expect((await send(2)).body.action).not.toBe("rate_limited");
    expect((await send(3)).body.action).toBe("rate_limited");
    expect((await send(4)).body.action).toBe("rate_limited");
    expect(fakeMail.to(OPS).filter((s) => /rate-limiting a sender/.test(s.subject))).toHaveLength(1);
    delete process.env.HOWDY_INBOUND_PER_SENDER_HOUR;
  });
});
