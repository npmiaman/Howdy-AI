"use client";

import { openHireDialog } from "@/components/hire-dialog";

export function FinalCTA() {
  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-16 text-center sm:px-6 md:py-24 lg:py-32">
      <div className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm md:px-4 md:py-1.5 md:text-xs">
        Get your match
      </div>

      <h2 className="mt-5 text-balance text-3xl leading-[1.05] tracking-tight md:mt-6 md:text-6xl lg:text-7xl">
        Find the best talent <em>in &lt;24hrs.</em>
      </h2>

      <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-white/70 md:mt-6 md:text-lg">
        Find talent that understands your brand, gets your taste, and ships
        the way you ship, hand-picked from a vetted network of designers,
        developers, editors, and specialists.
      </p>

      <div className="mt-8 md:mt-10">
        <button
          type="button"
          onClick={openHireDialog}
          className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-medium text-neutral-900 shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-colors hover:bg-white/90 md:h-14 md:px-10 md:text-base"
        >
          Get Started
        </button>
      </div>
    </section>
  );
}
