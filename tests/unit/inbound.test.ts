import { describe, expect, it } from "vitest";

import { parseInboundPayload, stripQuotedHistory } from "@/lib/agentmail/client";
import { classifyInbound, isJoinRequest, isTeamSender } from "@/lib/howdy/inbound-guard";

function payload(message: Record<string, unknown>) {
  return {
    event_type: "message.received",
    message: {
      from: "Dana Client <dana@client.co>",
      to: ["howdyai@agentmail.to"],
      thread_id: "thd_1",
      message_id: "msg_1",
      subject: "Hi",
      ...message,
    },
  };
}

describe("parseInboundPayload", () => {
  it("reads sender, all To/Cc addresses (lowercased) and the event type", () => {
    const m = parseInboundPayload(
      payload({
        to: ["Bernice <Limbernice@BridgeCreativesAgency.com>", "howdyai@agentmail.to"],
        cc: ["Other <other@x.com>"],
        extracted_text: "hello",
      }),
    );
    expect(m.eventType).toBe("message.received");
    expect(m.fromEmail).toBe("dana@client.co");
    expect(m.fromName).toBe("Dana Client");
    expect(m.to).toEqual(["limbernice@bridgecreativesagency.com", "howdyai@agentmail.to"]);
    expect(m.cc).toEqual(["other@x.com"]);
  });

  it("uses extracted_text when present", () => {
    expect(parseInboundPayload(payload({ extracted_text: "new bit", text: "new bit\n> old" })).body).toBe(
      "new bit",
    );
  });

  it("falls back to text without quoted history when extracted_text is empty", () => {
    const m = parseInboundPayload(
      payload({
        extracted_text: "",
        text: "Sounds good, go ahead.\n\nOn Wed, 1 Jul 2026 at 21:25, Mitchell Lim <mitchell@x.media>\nwrote:\n> earlier",
      }),
    );
    expect(m.body).toBe("Sounds good, go ahead.");
  });

  it("falls back to HTML last, and is empty when there's nothing readable", () => {
    expect(parseInboundPayload(payload({ html: "<p>Hi <b>there</b></p>" })).body).toBe("Hi there");
    expect(parseInboundPayload(payload({ extracted_text: "", text: "" })).body).toBe("");
  });
});

describe("stripQuotedHistory", () => {
  it.each([
    ["Yes!\n\nOn Tue, Howdy wrote:\n> are you open?", "Yes!"],
    ["Yes!\n-----Original Message-----\nFrom: Howdy", "Yes!"],
    ["Yes!\nFrom: Howdy <howdyai@agentmail.to>\nSent: Tuesday", "Yes!"],
    ["Line one\n> quoted\nLine two", "Line one\nLine two"],
    ["No quotes here", "No quotes here"],
  ])("%j → %j", (input, expected) => {
    expect(stripQuotedHistory(input)).toBe(expected);
  });
});

describe("classifyInbound", () => {
  const base = {
    eventType: "message.received",
    messageId: "m",
    threadId: "t",
    fromEmail: "dana@client.co",
    fromName: null,
    toEmail: "howdyai@agentmail.to",
    to: ["howdyai@agentmail.to"],
    cc: [],
    subject: "Need an editor",
    body: "I need a video editor",
    receivedAt: new Date(),
  };

  it.each([
    [{}, "process"],
    [{ fromEmail: "howdyai@agentmail.to" }, "ignored_self"],
    [{ fromEmail: "mailer-daemon@amazonses.com" }, "ignored_automated"],
    [{ fromEmail: "no-reply@calendly.com" }, "ignored_automated"],
    [{ subject: "Automatic reply: Out of office" }, "ignored_automated"],
    [{ subject: "Undeliverable: Welcome to Howdy" }, "ignored_automated"],
    [{ fromEmail: "limbernice@bridgecreativesagency.com" }, "team_sender"],
    [{ to: ["limbernice@bridgecreativesagency.com"], cc: ["howdyai@agentmail.to"] }, "cc_only"],
    [{ to: [] }, "process"],
    [{ body: "   " }, "empty_body"],
  ])("%j → %s", (over, verdict) => {
    expect(classifyInbound({ ...base, ...over })).toBe(verdict);
  });

  it("team membership is configurable", () => {
    process.env.HOWDY_TEAM_EMAILS = "ops@gmail.com";
    expect(isTeamSender("OPS@gmail.com")).toBe(true);
    delete process.env.HOWDY_TEAM_EMAILS;
    expect(isTeamSender("ops@gmail.com")).toBe(false);
  });

  it("recognises the roster join subject", () => {
    expect(isJoinRequest("Request to join Howdy's freelancer roster")).toBe(true);
    expect(isJoinRequest("Re: Request to join Howdy's freelancer roster")).toBe(true);
    expect(isJoinRequest("Need a video editor")).toBe(false);
  });
});
