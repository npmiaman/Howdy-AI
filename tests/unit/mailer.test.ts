import { describe, expect, it } from "vitest";

import { dispatch, isDryRun, wouldSend } from "@/lib/howdy/mailer";

import { fakeMail } from "../fakes/agentmail";

describe("saga mailer", () => {
  it("is dry-run unless explicitly set to false", () => {
    expect(isDryRun()).toBe(true);
    process.env.HOWDY_OUTREACH_DRYRUN = "0";
    expect(isDryRun()).toBe(true);
    process.env.HOWDY_OUTREACH_DRYRUN = "false";
    expect(isDryRun()).toBe(false);
  });

  it("in dry-run logs instead of sending, and says so", async () => {
    const res = await dispatch({ kind: "t", to: "x@y.co", subject: "s", text: "t" });
    expect(res.delivered).toBe(false);
    expect(fakeMail.sent).toHaveLength(0);
  });

  it("sends to allowlisted recipients only when every recipient is allowlisted", async () => {
    process.env.HOWDY_DRYRUN_ALLOWLIST = "Team@Howdy.co, qa@howdy.co";
    expect(wouldSend(["team@howdy.co"])).toBe(true);
    expect(wouldSend(["team@howdy.co", "real-freelancer@x.com"])).toBe(false);
    expect(wouldSend([])).toBe(false);
    const res = await dispatch({ kind: "t", to: "team@howdy.co", cc: ["qa@howdy.co"], subject: "s", text: "t" });
    expect(res.delivered).toBe(true);
    expect(fakeMail.sent).toHaveLength(1);
  });
});
