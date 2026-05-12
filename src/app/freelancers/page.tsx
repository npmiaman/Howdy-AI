import type { Metadata } from "next";
import { Check, ChevronDown, Star, X } from "lucide-react";

import { ContactDialog } from "@/components/contact-dialog";
import { EmailThread, type EmailMessage } from "@/components/email-thread";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const INVITE_MAILTO =
  "mailto:howdyai@agentmail.to?subject=Request%20to%20join%20Howdy%27s%20freelancer%20roster";

export const metadata: Metadata = {
  title: "Howdy: For Freelancers — An Invite-Only Roster",
  description:
    "Howdy's freelancer roster is invite-only. We hand-pick a small network of designers, developers, editors, and specialists, then send the right briefs straight to their inbox.",
};

export default function FreelancersPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="freelancer" />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-7xl px-4 pt-20 pb-2 sm:px-6 md:pt-24 md:pb-4 lg:pt-36 lg:pb-8">
          <Hero />
        </section>
        <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 md:pb-20 lg:pb-32">
          <BriefPreview />
          <StatStrip />
        </section>
        <HowItWorks />
        <Differentiation />
        <FinalCTA />
        <FAQ />
      </main>
      <SiteFooter />
      <ContactDialog />
    </div>
  );
}

function Hero() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 inline-flex items-center rounded-full bg-white px-3 py-1 text-[11px] font-medium text-neutral-900 md:mb-8 md:px-4 md:py-1.5 md:text-xs">
        Invite-only roster
      </div>

      <h1 className="text-balance text-3xl font-normal leading-[1.1] tracking-tight md:text-5xl lg:text-[4.25rem]">
        Your Talent Needs
        <br />
        to be Discovered.
      </h1>

      <p className="mt-6 max-w-xl text-base text-white/70 md:mt-8 md:text-xl">
        No applications. We find you, and the work finds you.
      </p>

      <div className="mt-6 md:mt-8">
        <a
          href={INVITE_MAILTO}
          className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 bg-white/10 px-7 text-sm font-medium text-white shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/20 hover:text-white md:h-14 md:px-10 md:text-base"
        >
          Request an Invite
        </a>
      </div>
    </div>
  );
}

const PREVIEW_SUBJECT = "New brief from Howdy: 90-sec hero film, ~$3K, 2 weeks";

const PREVIEW_MESSAGES: EmailMessage[] = [
  {
    from: "Howdy",
    email: "howdy@howdy.ai",
    initial: "H",
    color: "bg-black",
    direction: "incoming",
    avatarSrc: "/howdy-logo.png",
    avatarBlend: true,
    time: "Tue 2:14 PM",
    snippet:
      "Cognition needs a launch film editor — Linear/Apple style, 2-week turnaround.",
    body: (
      <p>
        Hey Maya, got a brief that fits you. Cognition is launching end of
        month and needs a 90-sec hero film. Linear/Apple style, ~30 min raw
        footage, light motion + sound. Two-week turnaround, ~$3K. Want me to
        loop you in?
      </p>
    ),
  },
  {
    from: "Maya Liu",
    email: "maya@studio.co",
    initial: "M",
    color: "bg-rose-500",
    direction: "outgoing",
    time: "Tue 2:21 PM",
    snippet: "I'm in. Free Mon to start.",
    body: (
      <p>
        Yes, I&apos;m in. Free Monday to start. Send me the footage and brand
        guidelines and I&apos;ll come back with a cut plan by EOD.
      </p>
    ),
  },
];

function BriefPreview() {
  return (
    <EmailThread
      subject={PREVIEW_SUBJECT}
      messages={PREVIEW_MESSAGES}
      currentStep={1}
    />
  );
}

function StatStrip() {
  return (
    <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/70 md:text-base">
      <span>
        <span className="font-medium text-white">Zero</span> bidding wars
      </span>
      <span aria-hidden className="size-1 rounded-full bg-white/30" />
      <span>Briefs that actually fit</span>
      <span aria-hidden className="size-1 rounded-full bg-white/30" />
      <span className="flex items-center gap-2">
        <span className="flex">
          {Array.from({ length: 5 }).map((_, i) => {
            if (i < 4) {
              return (
                <Star
                  key={i}
                  className="size-3.5 fill-white text-white"
                />
              );
            }
            return (
              <span
                key={i}
                aria-hidden
                className="relative inline-block size-3.5"
              >
                <Star className="absolute inset-0 size-3.5 text-white/40" />
                <Star
                  className="absolute inset-0 size-3.5 fill-white text-white"
                  style={{ clipPath: "inset(0 50% 0 0)" }}
                />
              </span>
            );
          })}
        </span>
        <span>
          <span className="font-medium text-white">4.7</span> freelancer rating
        </span>
      </span>
    </div>
  );
}

const STEPS = [
  {
    title: "We find you",
    description:
      "Howdy scouts work in the wild — referrals, portfolios, the people other freelancers vouch for. If your work stands out, we reach out.",
  },
  {
    title: "A short conversation",
    description:
      "We chat about your taste, your stack, your rates, and the kind of work you want more of. No forms, no take-home tests.",
  },
  {
    title: "Briefs arrive in your inbox",
    description:
      "Once you're on the roster, matching briefs land in your inbox. Each one is pre-qualified and aligned with what you said you wanted.",
  },
  {
    title: "You get hired, directly",
    description:
      "I make the intro and step out of the way. You set the rate, you keep 100% of the work, no platform cut.",
  },
];

function HowItWorks() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <div className="mb-10 text-center md:mb-14">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-white/50 md:text-xs">
          How it works
        </p>
        <h2 className="text-balance text-2xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          We find you. Then the work finds you.
        </h2>
      </div>

      <ol className="grid gap-6 md:grid-cols-2 md:gap-8">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md md:p-8"
          >
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-white/40 md:text-sm">
              Step 0{i + 1}
            </span>
            <h3 className="mt-3 text-balance text-xl leading-tight tracking-tight md:text-2xl">
              {step.title}
            </h3>
            <p className="mt-3 text-base text-white/70 md:text-lg">
              {step.description}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const DIFF_ROWS = [
  {
    feature: "Your time, back",
    howdy: "Briefs come to you, pre-qualified",
    others: "Hours bidding on jobs you won't win",
  },
  {
    feature: "Keep what you earn",
    howdy: "Zero platform fees on the work",
    others: "10–20% taken off every invoice",
  },
  {
    feature: "Fit, not keywords",
    howdy: "Matched on taste, stack, and rate",
    others: "Drowned out by lowest bidder",
  },
  {
    feature: "Real relationships",
    howdy: "Direct intro to the hiring team",
    others: "Walled-garden chat, no contact info",
  },
];

function Differentiation() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <div className="mb-8 text-center md:mb-12">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-white/50 md:mb-4 md:text-xs">
          Why Howdy
        </p>
        <h2 className="text-balance text-2xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          What changes when you join the roster
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-white/60 md:mt-6 md:text-lg">
          No bidding, no fees on the work, no algorithm to game.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md">
        <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center border-b border-white/10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="px-3 py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-white/50 md:px-5 md:py-4 md:text-xs">
            What you get
          </div>
          <div className="border-l border-white/10 bg-white/10 px-3 py-3 text-center text-sm font-medium md:px-5 md:py-4 md:text-base">
            Howdy
          </div>
          <div className="border-l border-white/10 px-3 py-3 text-center text-[11px] text-white/60 md:px-5 md:py-4 md:text-sm">
            Other Portals
          </div>
        </div>

        {DIFF_ROWS.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-[1.2fr_1fr_1fr] items-stretch md:grid-cols-[1.4fr_1fr_1fr] ${
              i < DIFF_ROWS.length - 1 ? "border-b border-white/10" : ""
            }`}
          >
            <div className="px-3 py-3 text-sm font-medium md:px-5 md:py-5 md:text-base">
              {row.feature}
            </div>
            <div className="flex items-center gap-1.5 border-l border-white/10 bg-white/10 px-3 py-3 text-xs md:gap-2 md:px-5 md:py-5 md:text-sm">
              <Check className="size-3.5 shrink-0 text-emerald-400 md:size-4" />
              <span>{row.howdy}</span>
            </div>
            <div className="flex items-center gap-1.5 border-l border-white/10 px-3 py-3 text-xs text-white/60 md:gap-2 md:px-5 md:py-5 md:text-sm">
              <X className="size-3.5 shrink-0 text-white/30 md:size-4" />
              <span>{row.others}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-16 text-center sm:px-6 md:py-24 lg:py-32">
      <div className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm md:px-4 md:py-1.5 md:text-xs">
        Invite-only
      </div>

      <h2 className="mt-5 text-balance text-3xl leading-[1.05] tracking-tight md:mt-6 md:text-6xl lg:text-7xl">
        Think you should be <em>on the roster?</em>
      </h2>

      <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-white/70 md:mt-6 md:text-lg">
        We&apos;re keeping the network small on purpose. If your work speaks
        for itself, send a quick note with a link to your portfolio and
        we&apos;ll take a look.
      </p>

      <div className="mt-8 md:mt-10">
        <a
          href={INVITE_MAILTO}
          className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-medium text-neutral-900 shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-colors hover:bg-white/90 md:h-14 md:px-10 md:text-base"
        >
          Request an Invite
        </a>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: "How do freelancers actually get on the roster?",
    a: "Mostly through scouting and referrals. We find people via past work, recommendations from existing roster freelancers, and conversations with companies who've already hired them. There's no public application form.",
  },
  {
    q: "Can I request an invite?",
    a: "Yes. Send a short note to howdyai@agentmail.to with a portfolio link and the kind of work you love. We read every one, but we're keeping the network small, so we can't promise an invite.",
  },
  {
    q: "Why is it invite-only?",
    a: "Companies come to Howdy because every match is hand-vetted. Keeping the roster small is the only way to keep that bar high. We'd rather say no often than send a bad match once.",
  },
  {
    q: "Does Howdy take a cut of my rate?",
    a: "No. You set your rate, you invoice the company directly, you keep 100% of the work. Howdy makes its money on the company side.",
  },
  {
    q: "What if a brief isn't a fit?",
    a: "Just say no. Briefs are an offer, not an obligation. Tell me why, and I'll tune the next ones better.",
  },
  {
    q: "How often will I hear from you?",
    a: "Only when there's a real match. No newsletters, no batch blasts, no \"check the dashboard\" pings. Quiet inbox until something fits.",
  },
];

function FAQ() {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <div className="mb-8 text-center md:mb-12">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-white/50 md:mb-4 md:text-xs">
          FAQ
        </p>
        <h2 className="text-balance text-2xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          Things freelancers ask
        </h2>
      </div>

      <div className="space-y-2 md:space-y-3">
        {FAQS.map((faq) => (
          <FAQItem key={faq.q} question={faq.q} answer={faq.a} />
        ))}
      </div>
    </section>
  );
}

function FAQItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <details className="group rounded-xl border border-white/15 bg-white/5 px-6 py-4 backdrop-blur-md transition-colors open:bg-white/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="text-base font-medium md:text-lg">{question}</span>
        <ChevronDown className="size-5 shrink-0 text-white/60 transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-3 text-sm text-white/70 md:text-base">{answer}</p>
    </details>
  );
}
