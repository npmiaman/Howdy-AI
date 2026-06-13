"use client";

import { ArrowUpRight, X } from "lucide-react";

const BANNER_ASCII = `+ ~ :: x* . :+ ~. * :  .
 *x. :+ ~ .x+ : ~* + :.
. ~ *: +x .: *~ x. + *`;

export function RebrandBanner({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className="sticky top-0 z-[60] flex h-10 items-center justify-center gap-2.5 overflow-hidden bg-zinc-950 px-10 text-white md:gap-3 md:px-12">
      {/* ASCII flourish, left side */}
      <pre
        aria-hidden
        className="pointer-events-none absolute left-2 top-1/2 hidden -translate-y-1/2 select-none font-mono text-[8px] leading-[10px] text-zinc-600 [mask-image:linear-gradient(to_right,black,transparent)] md:block md:w-64"
      >
        {BANNER_ASCII}
      </pre>

      <span className="rounded-md bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-zinc-950 md:text-[10px]">
        New
      </span>
      <p className="truncate text-[12px] md:text-[14px]">
        Bridge Creatives is now <span className="font-semibold">Howdy</span>
        <span className="hidden text-zinc-300 sm:inline">
          {" "}
          — same crew, new chapter.
        </span>
      </p>
      <a
        href="#why-howdy"
        className="flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-zinc-400 underline underline-offset-2 transition-colors hover:text-white md:text-[13px]"
      >
        Learn More
        <ArrowUpRight className="size-3" />
      </a>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/10 hover:text-white md:right-4"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
