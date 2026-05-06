"use client";

import { useEffect, useRef, useState } from "react";

import { EmailThread, type EmailMessage } from "@/components/email-thread";

const SUBJECT = "Hey Howdy help me find an editor for our launch film";

const MESSAGES: EmailMessage[] = [
  {
    from: "Zhang Wei",
    email: "zhang@cognition.com",
    initial: "Z",
    color: "bg-amber-500",
    direction: "outgoing",
    avatarSrc: "/zhang-avatar.jpg",
    time: "Mon 10:14 AM",
    snippet:
      "Launching end of month. 90-sec hero film, ~30 min footage to cut.",
    body: (
      <p>
        Hey Howdy, launching our product end of month and need a 90-sec hero
        film for the homepage. Have ~30 min of raw interview + product
        footage to cut down. Two-week turnaround, reasonable budget. Need
        someone reliable who&apos;s done launch films before. Got anyone in
        your network?
      </p>
    ),
  },
  {
    from: "Howdy",
    email: "howdy@howdy.ai",
    initial: "H",
    color: "bg-black",
    direction: "incoming",
    avatarSrc: "/howdy-logo.png",
    avatarBlend: true,
    time: "Mon 10:16 AM",
    snippet: "Quick questions: style? deadline? footage? motion + sound?",
    body: (
      <>
        <p>On it. Quick brief check:</p>
        <ul className="list-disc pl-5">
          <li>Style references?</li>
          <li>Deadline?</li>
          <li>What footage are you working with?</li>
          <li>Motion graphics or sound design needed?</li>
        </ul>
      </>
    ),
  },
  {
    from: "Zhang Wei",
    email: "zhang@cognition.com",
    initial: "Z",
    color: "bg-amber-500",
    direction: "outgoing",
    avatarSrc: "/zhang-avatar.jpg",
    time: "Mon 10:32 AM",
    snippet:
      "Linear/Apple style, 2 weeks, ~30 min raw footage. Refs attached.",
    body: (
      <p>
        Linear/Apple style, 2-week deadline, ~30 min of raw footage. Light
        motion graphics + original sound. Refs and brand guidelines attached.
      </p>
    ),
    attachments: [
      { name: "brand-guidelines.pdf", size: "4.2 MB", kind: "pdf" },
      { name: "moodboard.png", size: "2.1 MB", kind: "image" },
    ],
  },
  {
    from: "Howdy",
    email: "howdy@howdy.ai",
    initial: "H",
    color: "bg-black",
    direction: "incoming",
    avatarSrc: "/howdy-logo.png",
    avatarBlend: true,
    time: "Mon 11:08 AM",
    snippet: "Match: Maya Liu, ex-Vox, $35/hr, starts tomorrow.",
    body: (
      <p>
        Got your match. <strong>Maya Liu</strong>, ex-Vox, 8 yrs Premiere/AE,
        $35/hr. Starts tomorrow. Reel below.
      </p>
    ),
  },
];

const STEPS = [
  {
    title: "Tell me what you need",
    description: "Describe the project and deadline in plain English.",
  },
  {
    title: "I dig into the details",
    description: "I lock down style, footage, motion, and sound.",
  },
  {
    title: "You confirm the scope",
    description: "Pin down references and deliverables so the match is exact.",
  },
  {
    title: "I send your match",
    description: "Vetted creative, reel + rate, ready to start.",
  },
];

export function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let frame = 0;
    function update() {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const totalScroll = rect.height - viewportH;
      const scrolled = -rect.top;
      const progress = Math.max(0, Math.min(1, scrolled / totalScroll));
      const idx = Math.min(
        STEPS.length - 1,
        Math.floor(progress * STEPS.length),
      );
      setStep(idx);
    }
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative w-full"
      style={{ height: `${STEPS.length * 100}vh` }}
    >
      <div className="sticky top-0 flex h-screen items-center">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-2 lg:gap-10">
          {/* Left: heading + vertical sidebar steps */}
          <div className="flex flex-col">
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
              How it works
            </p>
            <h2 className="mb-12 text-balance text-3xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
              From your brief to a vetted match in four steps.
            </h2>

            <ol className="flex flex-col items-start gap-1.5">
              {STEPS.map((s, i) => {
                const active = i === step;
                return (
                  <li
                    key={s.title}
                    className={`rounded-lg px-4 py-2.5 transition-colors duration-500 ${
                      active
                        ? "border border-white/15 bg-white/10"
                        : "border border-transparent"
                    }`}
                  >
                    <span
                      className={`block text-base leading-tight transition-opacity duration-500 md:text-lg ${
                        active ? "opacity-100" : "opacity-40"
                      }`}
                    >
                      {s.title}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Right: pinned email thread */}
          <div className="flex justify-center lg:justify-end">
            <EmailThread
              subject={SUBJECT}
              messages={MESSAGES}
              currentStep={step}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
