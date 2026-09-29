import { describe, expect, it, vi } from "vitest";

import {
  approveApplication,
  listApplications,
  rejectApplication,
} from "@/lib/howdy/applications";
import { ensureFreelancerEmbeddings } from "@/lib/howdy/data";

import { fakeMail } from "../fakes/agentmail";
import { fakeDb } from "../fakes/supabase";
import { T0 } from "../setup";
import { freelancer, seedFreelancers, table } from "../helpers";

const VALID = {
  fullName: "Maya Liu",
  email: "maya@studio.co",
  role: "Video Editor",
  portfolioUrl: "https://maya.studio/reel",
  rateUsdPerHour: "65",
  timezone: "Asia/Singapore",
  skills: "Premiere Pro, After Effects, DaVinci Resolve",
  bio: "Launch films and social cuts for consumer brands.",
  website: "",
};

async function apply(body: unknown) {
  const { POST } = await import("@/app/api/freelancer-apply/route");
  const res = await POST(
    new Request("http://localhost/api/freelancer-apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Ops alerts go to HOWDY_NOTIFY_EMAIL (or its default), so match on subject. */
function opsAlerts() {
  return fakeMail.sent.filter((s) => /freelancer application/i.test(s.subject));
}

function applications() {
  return table("freelancer_applications");
}

async function pendingId(): Promise<string> {
  const res = await apply(VALID);
  expect(res.status).toBe(200);
  return applications()[0].id as string;
}

describe("POST /api/freelancer-apply", () => {
  it("rejects bad input with 422 and stores/sends nothing", async () => {
    const noPortfolio: Record<string, unknown> = { ...VALID };
    delete noPortfolio.portfolioUrl;
    const missing = await apply(noPortfolio);
    expect(missing.status).toBe(422);
    expect(JSON.stringify(missing.body.issues)).toContain("portfolioUrl");

    const badEmail = await apply({ ...VALID, email: "maya-at-studio" });
    expect(badEmail.status).toBe(422);
    expect(JSON.stringify(badEmail.body.issues)).toContain("email");

    const notHttp = await apply({ ...VALID, portfolioUrl: "javascript:alert(1)" });
    expect(notHttp.status).toBe(422);

    expect(applications()).toHaveLength(0);
    expect(fakeMail.sent).toHaveLength(0);
  });

  it("stores a valid application as pending with normalized fields", async () => {
    const res = await apply({
      ...VALID,
      email: "Maya@Studio.co",
      portfolioUrl: "behance.net/mayaliu",
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });

    const rows = applications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      full_name: "Maya Liu",
      email: "maya@studio.co",
      role: "Video Editor",
      portfolio_url: "https://behance.net/mayaliu",
      rate_usd_per_hour: 65,
      timezone: "Asia/Singapore",
      skills: ["Premiere Pro", "After Effects", "DaVinci Resolve"],
      bio: "Launch films and social cuts for consumer brands.",
      source: "freelancers-page",
      status: "pending",
      reviewed_at: null,
    });
  });

  it("sends the applicant an honest confirmation", async () => {
    await apply(VALID);
    const mails = fakeMail.to("maya@studio.co");
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Got your application, Maya");
    expect(mails[0].text).toMatch(/real person/i);
    expect(mails[0].text).toMatch(/we'll email you/i);
    // No timeline the code doesn't enforce.
    expect(mails[0].text).not.toMatch(/\b(hours?|days?|weeks?|soon|shortly)\b/i);
  });

  it("alerts ops with every field", async () => {
    await apply(VALID);
    const alerts = opsAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].subject).toBe("🔔 New freelancer application: Maya Liu (Video Editor)");
    const id = applications()[0].id as string;
    for (const s of [
      "Maya Liu",
      "maya@studio.co",
      "Video Editor",
      "https://maya.studio/reel",
      "$65/hr",
      "Asia/Singapore",
      "Premiere Pro, After Effects, DaVinci Resolve",
      "Launch films and social cuts for consumer brands.",
      `pending application ${id}`,
      `npm run applications approve ${id}`,
      "Confirmation email to applicant: sent.",
    ]) {
      expect(alerts[0].text).toContain(s);
    }
  });

  it("updates a pending application when the same email (any case) resubmits", async () => {
    await apply(VALID);
    const id = applications()[0].id;
    const again = await apply({
      ...VALID,
      email: "MAYA@STUDIO.CO",
      role: "Motion Designer",
      skills: ["Cinema 4D", "After Effects"],
      rateUsdPerHour: 80,
    });
    expect(again.status).toBe(200);

    const rows = applications();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      email: "maya@studio.co",
      role: "Motion Designer",
      skills: ["Cinema 4D", "After Effects"],
      rate_usd_per_hour: 80,
      status: "pending",
    });
    expect(opsAlerts()[1].subject).toMatch(/^🔔 Updated freelancer application/);
  });

  it("drops honeypot submissions silently", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await apply({ ...VALID, website: "http://spam.example" });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(applications()).toHaveLength(0);
    expect(fakeMail.sent).toHaveLength(0);
  });

  it("still succeeds when the DB write fails, and says so in the ops alert", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDb.failNext("freelancer_applications", "insert");

    const res = await apply(VALID);
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(applications()).toHaveLength(0);

    // The full payload is in the logs...
    const logged = errors.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("could not store application");
    expect(logged).toContain("https://maya.studio/reel");

    // ...and in the ops alert, flagged as not stored.
    const [alert] = opsAlerts();
    expect(alert.subject).toBe("⚠️ Freelancer application NOT saved: Maya Liu (Video Editor)");
    expect(alert.text).toContain("NOT STORED");
    expect(alert.text).toContain("maya@studio.co");
    expect(alert.text).toContain("https://maya.studio/reel");

    // The applicant still hears back.
    expect(fakeMail.to("maya@studio.co")).toHaveLength(1);
  });
});

describe("reviewing applications", () => {
  it("approve promotes into freelancers, then the self-heal embeds the new row", async () => {
    const id = await pendingId();
    const f = await approveApplication(id);

    expect(f.id).toMatch(/^maya-liu-[0-9a-f]{6}$/);
    const [row] = table("freelancers");
    expect(row).toMatchObject({
      id: f.id,
      name: "Maya Liu",
      email: "maya@studio.co",
      role: "Video Editor",
      skills: ["Premiere Pro", "After Effects", "DaVinci Resolve"],
      specialties: [],
      rate_usd_per_hour: 65,
      timezone: "Asia/Singapore",
      timezone_overlap_hours: [],
      availability_hours_per_week: 20,
      bio: "Launch films and social cuts for consumer brands.",
      portfolio_summary:
        "Portfolio: https://maya.studio/reel. Launch films and social cuts for consumer brands.",
      embedding: null,
    });
    expect(applications()[0]).toMatchObject({
      status: "approved",
      freelancer_id: f.id,
      reviewed_at: T0.toISOString(),
    });

    const healed = await ensureFreelancerEmbeddings();
    expect(healed).toEqual({ embedded: 1, failed: 0, missing: 1 });
    expect(table("freelancers")[0].embedding).toEqual(expect.any(String));
  });

  it("refuses to approve an application twice", async () => {
    const id = await pendingId();
    await approveApplication(id);
    await expect(approveApplication(id)).rejects.toThrow(/already approved/);
    expect(table("freelancers")).toHaveLength(1);
  });

  it("reject marks the application rejected and adds nobody to the roster", async () => {
    const id = await pendingId();
    await rejectApplication(id);
    expect(applications()[0]).toMatchObject({
      status: "rejected",
      reviewed_at: T0.toISOString(),
    });
    expect(applications()[0].freelancer_id ?? null).toBeNull();
    await expect(approveApplication(id)).rejects.toThrow(/already rejected/);
    await expect(rejectApplication(id)).rejects.toThrow(/already rejected/);
    expect(table("freelancers")).toHaveLength(0);
  });

  it("needs a rate and timezone before approving, taken from overrides if the applicant skipped them", async () => {
    await apply({ ...VALID, rateUsdPerHour: "", timezone: "" });
    const id = applications()[0].id as string;

    await expect(approveApplication(id)).rejects.toThrow(/no hourly rate/);
    await expect(approveApplication(id, { rateUsdPerHour: 50 })).rejects.toThrow(/no timezone/);
    expect(table("freelancers")).toHaveLength(0);

    const f = await approveApplication(id, { rateUsdPerHour: 50, timezone: "Europe/Berlin" });
    expect(f).toMatchObject({ rate_usd_per_hour: 50, timezone: "Europe/Berlin" });
  });

  it("refuses to approve someone already on the roster", async () => {
    seedFreelancers([freelancer({ id: "maya-old", email: "Maya@Studio.co" })]);
    const id = await pendingId();
    await expect(approveApplication(id)).rejects.toThrow(/already on the roster as maya-old/);
    expect(table("freelancers")).toHaveLength(1);
    expect(applications()[0].status).toBe("pending");
  });

  it("lists applications, optionally by status", async () => {
    await apply(VALID);
    await apply({ ...VALID, fullName: "Omar Said", email: "omar@example.com" });
    const [first] = await listApplications("pending");
    await rejectApplication(first.id);

    expect((await listApplications()).map((a) => a.email)).toEqual([
      "maya@studio.co",
      "omar@example.com",
    ]);
    expect((await listApplications("pending")).map((a) => a.email)).toEqual(["omar@example.com"]);
    expect((await listApplications("rejected")).map((a) => a.email)).toEqual(["maya@studio.co"]);
  });
});
