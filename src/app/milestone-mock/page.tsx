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

// A client (the hirer) messaging Howdy. "outgoing" → green/right in WhatsApp.
const client = {
  from: "Maya Chen",
  email: "maya@northwind.studio",
  initial: "M",
  color: "bg-rose-500",
  direction: "outgoing" as const,
};

const clientBrief: EmailMessage = {
  ...client,
  time: "11:02 AM",
  snippet:
    "Hey! Help me hire a motion graphics artist for our next launch — a ~30s animated explainer. Files below 👇",
  body: (
    <>
      <p>Hey!</p>
      <p>
        Help me hire a motion graphics artist for our next launch — a ~30s
        animated explainer. Files below.
      </p>
      <p>— Maya</p>
    </>
  ),
  attachments: [
    { name: "Brand Guidelines", size: "—", kind: "gdoc" },
    { name: "Launch Moodboard.png", size: "—", kind: "gdrive" },
  ],
};

const howdyReply: EmailMessage = {
  ...howdy,
  time: "11:09 AM",
  snippet:
    "Love this — kinetic type + minimal is a great call for an explainer. Going through your guidelines + moodboard now. I'll line up a vetted motion designer who's shipped app-launch explainers and send you a shortlist by EOD 🤝",
  body: (
    <>
      <p>Hi Maya,</p>
      <p>
        Love this — kinetic type + minimal is a great call for a launch
        explainer. I&apos;m going through your brand guidelines and moodboard now.
      </p>
      <p>
        I&apos;ll line up a vetted motion designer who&apos;s shipped app-launch
        explainers and send you a shortlist by end of day.
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

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            3 · Client brief + shared files
          </p>
          <EmailThread
            subject="Hiring a motion graphics freelancer"
            messages={[clientBrief]}
            currentStep={0}
          />
        </section>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            4 · Howdy responds
          </p>
          <EmailThread
            subject="Re: Hiring a motion graphics freelancer"
            messages={[howdyReply]}
            currentStep={0}
          />
        </section>
      </div>
    </main>
  );
}
