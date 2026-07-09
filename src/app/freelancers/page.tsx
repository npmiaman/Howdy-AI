import type { Metadata } from "next";
import Image from "next/image";
import { ArrowUpRight, Check, ChevronDown, Sparkles, Star, X } from "lucide-react";

import { ContactDialog } from "@/components/contact-dialog";
import { EmailThread, type EmailMessage } from "@/components/email-thread";
import { HomeChrome } from "@/components/home-chrome";
import { SiteFooter } from "@/components/site-footer";
import { CAT_ASCII, BLOB_ASCII } from "@/lib/ascii-art";

const INVITE_MAILTO =
  "mailto:howdyai@agentmail.to?subject=Request%20to%20join%20Howdy%27s%20freelancer%20roster";

export const metadata: Metadata = {
  title: "Howdy: For Freelancers — An Invite-Only Roster",
  description:
    "Howdy's creative roster is invite-only. We hand-pick a small network of designers, video editors, motion artists, illustrators, and writers, then send the right briefs straight to their inbox.",
};

export default function FreelancersPage() {
  return (
    <div className="relative z-0 flex min-h-screen flex-col overflow-x-clip text-zinc-900">
      {/* White page bg — covers the dark layout backdrop. */}
      <div aria-hidden className="fixed inset-0 -z-20 bg-white" />
      <HomeChrome variant="freelancer" />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 pt-4 sm:px-10 md:px-14 md:pt-6 md:pb-6">
          <HeroCard />
        </section>
        <section className="mx-auto w-full max-w-7xl px-4 pt-10 pb-12 sm:px-6 md:pt-14 md:pb-16">
          <StatStrip />
        </section>
        <HowItWorks />
        <Differentiation />
        <FinalCTA />
        <FAQ />
        <SiteFooter />
      </main>
      <ContactDialog />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero — sky card mirroring the company home page, with the freelancer's
// side of the conversation: a fitting brief lands in the inbox.
// ---------------------------------------------------------------------------
const HERO_SUBJECT = "New brief from Howdy: 90-sec hero film, ~$3K, 2 weeks";

const HERO_MESSAGES: EmailMessage[] = [
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

function HeroCard() {
  return (
    <div
      className="relative transform-gpu overflow-hidden rounded-[28px] [-webkit-mask-image:-webkit-radial-gradient(white,black)] md:rounded-[36px]"
      style={{ isolation: "isolate" }}
    >
      <Image
        src="/bg.jpg"
        alt=""
        fill
        priority
        sizes="(min-width: 1400px) 1400px, 100vw"
        className="object-cover"
        style={{ filter: "blur(1.5px)" }}
      />
      <div aria-hidden className="absolute inset-0 bg-black/20" />
      <div className="relative flex flex-col items-center px-5 py-9 text-center md:px-8 md:py-11 lg:py-12">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/[0.12] px-4 py-1.5 text-xs font-medium text-white shadow-[0_4px_18px_rgba(0,0,0,0.18)] backdrop-blur-md">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          Invite-only roster
          <Sparkles className="size-3" />
        </span>

        <h1 className="mt-7 max-w-4xl text-balance text-3xl font-normal leading-[1.05] tracking-tight text-white md:mt-9 md:text-5xl lg:text-6xl">
          Your Talent Needs
          <br />
          to be Discovered.
        </h1>

        <p className="mt-4 max-w-xl text-balance text-sm leading-relaxed text-white/85 md:mt-5 md:text-base">
          No applications, no bidding wars. We find you — and the right briefs
          land straight in your inbox.
        </p>

        <div className="mt-6 md:mt-8">
          <a
            href={INVITE_MAILTO}
            className="flex h-11 items-center gap-1 rounded-full border border-white/30 bg-white/15 pl-5 pr-1 text-sm font-medium text-white shadow-[0_10px_36px_rgba(0,0,0,0.2)] backdrop-blur-md transition-colors hover:border-white/40 hover:bg-white/25 hover:text-white md:h-13 md:pl-7 md:text-base"
          >
            <span>Request an Invite</span>
            <span className="flex size-9 items-center justify-center rounded-full border border-white/25 bg-white/20 text-white backdrop-blur-md md:size-11">
              <ArrowUpRight className="size-4 md:size-5" />
            </span>
          </a>
        </div>

        <div className="mt-8 w-full max-w-2xl text-left md:mt-10">
          <EmailThread
            subject={HERO_SUBJECT}
            messages={HERO_MESSAGES}
            currentStep={1}
          />
        </div>
      </div>
    </div>
  );
}

function StatStrip() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-zinc-600 md:text-base">
      <span>
        <span className="font-medium text-zinc-900">Zero</span> bidding wars
      </span>
      <span aria-hidden className="size-1 rounded-full bg-zinc-300" />
      <span>Briefs that actually fit</span>
      <span aria-hidden className="size-1 rounded-full bg-zinc-300" />
      <span className="flex items-center gap-2">
        <span className="flex">
          {Array.from({ length: 5 }).map((_, i) => {
            if (i < 4) {
              return (
                <Star key={i} className="size-3.5 fill-zinc-900 text-zinc-900" />
              );
            }
            return (
              <span
                key={i}
                aria-hidden
                className="relative inline-block size-3.5"
              >
                <Star className="absolute inset-0 size-3.5 text-zinc-300" />
                <Star
                  className="absolute inset-0 size-3.5 fill-zinc-900 text-zinc-900"
                  style={{ clipPath: "inset(0 50% 0 0)" }}
                />
              </span>
            );
          })}
        </span>
        <span>
          <span className="font-medium text-zinc-900">4.7</span> freelancer
          rating
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// How it works — light stacked steps, alternating with the brief thread.
// ---------------------------------------------------------------------------
const STEPS = [
  {
    title: "We find you",
    description:
      "Howdy scouts work in the wild — referrals, portfolios, the people other freelancers vouch for. If your work stands out, we reach out.",
  },
  {
    title: "A short conversation",
    description:
      "We chat about your taste, your craft, your rates, and the kind of work you want more of. No forms, no spec work.",
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
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
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
            className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 md:p-8"
          >
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400 md:text-sm">
              Step 0{i + 1}
            </span>
            <h3 className="mt-3 text-balance text-xl leading-tight tracking-tight md:text-2xl">
              {step.title}
            </h3>
            <p className="mt-3 text-base text-zinc-600 md:text-lg">
              {step.description}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Differentiation — two-card layout mirroring the company page.
// ---------------------------------------------------------------------------
const OTHERS = [
  "Hours bidding on jobs you won't win",
  "10–20% taken off every invoice",
  "Drowned out by the lowest bidder",
  "Walled-garden chat, no contact info",
];

const HOWDY = [
  "Briefs come to you, pre-qualified",
  "Zero platform fees on the work",
  "Matched on taste, craft, and rate",
  "Direct intro to the hiring team",
];

function Differentiation() {
  return (
    <section className="relative mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <pre
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 select-none font-mono text-[10px] leading-[9px] text-zinc-400/70 md:text-[20px] md:leading-[17px]"
      >
        {CAT_ASCII}
      </pre>
      <div className="mb-8 text-center md:mb-14">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 md:mb-4 md:text-xs">
          Why Howdy
        </p>
        <h2 className="text-balance text-2xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          What changes when you join the roster
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        {/* Freelancing elsewhere — muted */}
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-6 md:p-8">
          <p className="text-sm font-medium text-zinc-400 md:text-base">
            Freelancing elsewhere
          </p>
          <ul className="mt-5 space-y-4 md:mt-6">
            {OTHERS.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <X className="mt-0.5 size-4 shrink-0 text-zinc-300 md:size-5" />
                <span className="text-sm text-zinc-500 md:text-base">
                  {line}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* On the Howdy roster — elevated charcoal */}
        <div className="rounded-3xl bg-zinc-900 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.18)] md:p-8">
          <p className="flex items-center gap-2 text-sm font-medium text-white md:text-base">
            <Image
              src="/howdy-logo.png"
              alt=""
              width={24}
              height={24}
              className="size-5 shrink-0 invert mix-blend-screen md:size-6"
            />
            On the Howdy roster
          </p>
          <ul className="mt-5 space-y-4 md:mt-6">
            {HOWDY.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-400 md:size-5" />
                <span className="text-sm text-white md:text-base">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-16 text-center sm:px-6 md:py-24 lg:py-32">
      <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] font-medium text-zinc-700 backdrop-blur-sm md:px-4 md:py-1.5 md:text-xs">
        Invite-only
      </div>

      <h2 className="mt-5 text-balance text-3xl leading-[1.05] tracking-tight md:mt-6 md:text-6xl lg:text-7xl">
        Think you should be <em>on the roster?</em>
      </h2>

      <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-zinc-600 md:mt-6 md:text-lg">
        We&apos;re keeping the network small on purpose. If your work speaks for
        itself, send a quick note with a link to your portfolio and we&apos;ll
        take a look.
      </p>

      <div className="mt-8 md:mt-10">
        <a
          href={INVITE_MAILTO}
          className="inline-flex h-12 items-center justify-center rounded-full bg-zinc-950 px-8 text-sm font-medium text-white shadow-[0_8px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-zinc-800 md:h-14 md:px-10 md:text-base"
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
    <section className="relative mx-auto w-full max-w-3xl overflow-hidden px-4 py-16 sm:px-6 md:overflow-visible md:py-24 lg:py-32">
      <pre
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 select-none font-mono text-[7px] leading-[6px] text-zinc-400/70 md:text-[20px] md:leading-[18px]"
      >
        {BLOB_ASCII}
      </pre>
      <div className="mb-8 text-center md:mb-12">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 md:mb-4 md:text-xs">
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

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-4 backdrop-blur-md transition-colors open:bg-zinc-100">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="text-base font-medium md:text-lg">{question}</span>
        <ChevronDown className="size-5 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-3 text-sm text-zinc-600 md:text-base">{answer}</p>
    </details>
  );
}
