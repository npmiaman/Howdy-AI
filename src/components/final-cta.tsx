"use client";

import { openHireDialog } from "@/components/hire-dialog";

export function FinalCTA() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-24 text-center lg:py-32">
      <div className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm">
        Get your match
      </div>

      <h2 className="mt-6 text-balance text-4xl leading-[1.05] tracking-tight md:text-6xl lg:text-7xl">
        Find the best talent <em>in &lt;24hrs.</em>
      </h2>

      <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-white/70 md:text-lg">
        Find talent that understands your brand, gets your taste, and ships
        the way you ship, hand-picked from a vetted network of designers,
        developers, editors, and specialists.
      </p>

      <div className="mt-10">
        <button
          type="button"
          onClick={openHireDialog}
          className="inline-flex h-14 items-center justify-center rounded-full bg-white px-10 text-base font-medium text-neutral-900 shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-colors hover:bg-white/90"
        >
          Get Started
        </button>
      </div>
    </section>
  );
}
