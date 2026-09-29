import { describe, expect, it } from "vitest";

import { signPayload } from "@/lib/howdy/webhook-auth";

import { fakeMail } from "../fakes/agentmail";
import { postWebhook } from "../helpers";

const SECRET = `whsec_${Buffer.from("super-secret-signing-key").toString("base64")}`;

function signed(body: string, opts: { secret?: string; ageSeconds?: number } = {}) {
  const id = "msg_2x";
  const ts = String(Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0));
  const sig = signPayload(opts.secret ?? SECRET, id, ts, body).toString("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
}

describe("webhook signature (Svix)", () => {
  const body = () =>
    JSON.stringify(fakeMail.inbound({ from: "dana@client.co", subject: "Hi", text: "I need a video editor" }));

  it("accepts a correctly signed request", async () => {
    process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
    const b = body();
    const res = await postWebhook(b, signed(b));
    expect(res.status).toBe(200);
  });

  it("rejects unsigned, wrongly signed, tampered and stale requests", async () => {
    process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
    const b = body();
    expect((await postWebhook(b)).status).toBe(401);
    const wrong = `whsec_${Buffer.from("other").toString("base64")}`;
    expect((await postWebhook(b, signed(b, { secret: wrong }))).status).toBe(401);
    expect((await postWebhook(b.replace("video", "audio"), signed(b))).status).toBe(401);
    expect((await postWebhook(b, signed(b, { ageSeconds: 600 }))).status).toBe(401);
    expect(fakeMail.sent).toHaveLength(0);
  });

  it("accepts one valid signature among several (key rotation)", async () => {
    process.env.AGENTMAIL_WEBHOOK_SECRET = SECRET;
    const b = body();
    const h = signed(b);
    h["svix-signature"] = `v1,bm90LXRoaXMtb25l ${h["svix-signature"]}`;
    expect((await postWebhook(b, h)).status).toBe(200);
  });

  it("refuses to run unauthenticated in production, but allows it elsewhere", async () => {
    process.env.VERCEL_ENV = "production";
    expect((await postWebhook(body())).status).toBe(503);
    process.env.VERCEL_ENV = "preview";
    expect((await postWebhook(body())).status).toBe(200);
  });
});
