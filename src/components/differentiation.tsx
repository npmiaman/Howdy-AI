import Image from "next/image";
import { Check, X } from "lucide-react";

import { CAT_ASCII } from "@/lib/ascii-art";

const OTHERS = [
  "Days lost screening cold applicants",
  "You vet strangers yourself",
  "Hundreds of portfolios to sift through",
  "Matched on keywords alone",
];

const HOWDY = [
  "First match in minutes",
  "Pre-vetted before you see a name",
  "One curated match, ready to hire",
  "Matched on taste, budget, and brand",
];

export function Differentiation() {
  return (
    <section
      id="why-howdy"
      className="relative mx-auto w-full max-w-4xl scroll-mt-24 px-4 py-16 sm:px-6 md:py-24 lg:py-32"
    >
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
          What changes when you use Howdy
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        {/* Other portals — muted */}
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-6 md:p-8">
          <p className="text-sm font-medium text-zinc-400 md:text-base">
            Hiring elsewhere
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

        {/* Howdy — elevated charcoal */}
        <div className="rounded-3xl bg-zinc-900 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.18)] md:p-8">
          <p className="flex items-center gap-2 text-sm font-medium text-white md:text-base">
            <Image
              src="/howdy-logo.png"
              alt=""
              width={24}
              height={24}
              className="size-5 shrink-0 invert mix-blend-screen md:size-6"
            />
            Hiring with Howdy
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
