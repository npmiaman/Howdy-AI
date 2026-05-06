import { Check, X } from "lucide-react";

const ROWS = [
  {
    feature: "Get your week back",
    howdy: "First match in minutes",
    others: "Days lost screening cold applicants",
  },
  {
    feature: "Hire with confidence",
    howdy: "Every freelancer is pre-vetted",
    others: "You vet strangers yourself",
  },
  {
    feature: "Skip decision fatigue",
    howdy: "One curated match, not a haystack",
    others: "Sift through hundreds of profiles",
  },
  {
    feature: "Talent that actually fits",
    howdy: "Matched on taste and brand",
    others: "Matched on keywords alone",
  },
];

export function Differentiation() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 md:py-24 lg:py-32">
      <div className="mb-8 text-center md:mb-12">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-white/50 md:mb-4 md:text-xs">
          Why Howdy
        </p>
        <h2 className="text-balance text-2xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          What changes when you use Howdy
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-sm text-white/60 md:mt-6 md:text-lg">
          Skip the noise. Get a match that actually fits, faster.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md">
        {/* Header row */}
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

        {/* Body rows */}
        {ROWS.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-[1.2fr_1fr_1fr] items-stretch md:grid-cols-[1.4fr_1fr_1fr] ${
              i < ROWS.length - 1 ? "border-b border-white/10" : ""
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
