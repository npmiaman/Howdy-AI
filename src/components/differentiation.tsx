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
    <section className="mx-auto w-full max-w-5xl px-6 py-24 lg:py-32">
      <div className="mb-12 text-center">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
          Why Howdy
        </p>
        <h2 className="text-balance text-3xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          What changes when you use Howdy
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-white/60">
          Skip the noise. Get a match that actually fits, faster.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md">
        {/* Header row */}
        <div className="grid grid-cols-[1.4fr_1fr_1fr] items-center border-b border-white/10">
          <div className="px-5 py-4 text-xs font-medium uppercase tracking-[0.14em] text-white/50">
            What you get
          </div>
          <div className="border-l border-white/10 bg-white/10 px-5 py-4 text-center text-base font-medium">
            Howdy
          </div>
          <div className="border-l border-white/10 px-5 py-4 text-center text-sm text-white/60">
            Other Freelance Portals
          </div>
        </div>

        {/* Body rows */}
        {ROWS.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-[1.4fr_1fr_1fr] items-stretch ${
              i < ROWS.length - 1 ? "border-b border-white/10" : ""
            }`}
          >
            <div className="px-5 py-5 text-base font-medium">
              {row.feature}
            </div>
            <div className="flex items-center gap-2 border-l border-white/10 bg-white/10 px-5 py-5 text-sm">
              <Check className="size-4 shrink-0 text-emerald-400" />
              <span>{row.howdy}</span>
            </div>
            <div className="flex items-center gap-2 border-l border-white/10 px-5 py-5 text-sm text-white/60">
              <X className="size-4 shrink-0 text-white/30" />
              <span>{row.others}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
