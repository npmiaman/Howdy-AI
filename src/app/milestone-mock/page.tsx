import { EmailThread, type EmailMessage } from "@/components/email-thread";

// Temporary mock page — two Gmail-style emails from Howdy to the client.

const howdy = {
  from: "Howdy",
  email: "howdy@howdy.ai",
  initial: "H",
  color: "bg-black",
  direction: "incoming" as const,
  avatarSrc: "/howdy-logo.png",
  avatarBlend: true,
};

const milestoneEmail: EmailMessage = {
  ...howdy,
  time: "9:14 AM",
  snippet:
    "Jessica has uploaded for this week's milestone — I've attached the document below.",
  body: (
    <>
      <p>Hey,</p>
      <p>
        Jessica has uploaded for this week&apos;s milestone — I&apos;ve attached
        the document below. Do you have any feedback on her?
      </p>
      <p>— Howdy</p>
    </>
  ),
  attachments: [
    { name: "Jessica — Week 4 Milestone.pdf", size: "2.4 MB", kind: "pdf" },
  ],
};

const paymentEmail: EmailMessage = {
  ...howdy,
  time: "2:40 PM",
  snippet: "The payment for Milestone 3 has been completed and released.",
  body: (
    <>
      <p>Hi,</p>
      <p>
        The payment for Milestone 3 has been completed and released. You&apos;re
        all set on this one.
      </p>
      <p>— Howdy</p>
    </>
  ),
};

export default function MilestoneMockPage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-12 md:py-16">
      <div className="mx-auto flex max-w-2xl flex-col gap-12">
        <header className="text-center">
          <h1 className="text-lg font-semibold text-neutral-800 md:text-xl">
            Howdy → Client
          </h1>
          <p className="mt-1 text-sm text-neutral-500">Milestone updates (mock)</p>
        </header>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            1 · Milestone upload + feedback request
          </p>
          <EmailThread
            subject="This week's milestone — Jessica"
            messages={[milestoneEmail]}
            currentStep={0}
          />
        </section>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            2 · Payment released
          </p>
          <EmailThread
            subject="Milestone 3 — payment released"
            messages={[paymentEmail]}
            currentStep={0}
          />
        </section>
      </div>
    </main>
  );
}
