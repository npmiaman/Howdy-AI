import { Check } from "lucide-react";

const INCLUDED = [
  "We recommend you 3 profiles",
  "Taste, budget, and brand fit built in",
  "No subscription, pay as you hire",
];

export function Pricing() {
  return (
    <section
      id="pricing"
      className="relative mx-auto w-full max-w-4xl scroll-mt-24 px-4 py-16 sm:px-6 md:py-24 lg:py-32"
    >
      <div className="mb-8 text-center md:mb-14">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 md:mb-4 md:text-xs">
          Pricing
        </p>
        <h2 className="text-balance text-2xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          Simple, pay-as-you-hire pricing
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:gap-6">
        {/* Per-match fee */}
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-6 md:p-8">
          <p className="text-sm font-medium text-zinc-500 md:text-base">
            Per match
          </p>
          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-4xl font-normal tracking-tight text-zinc-900 md:text-5xl">
              $50
            </span>
            <span className="text-sm text-zinc-500 md:text-base">
              / match
            </span>
          </p>
          <p className="mt-4 text-sm text-zinc-600 md:text-base">
            A flat fee for every vetted creative we introduce you to.
          </p>
        </div>

        {/* Service fee */}
        <div className="rounded-3xl bg-zinc-900 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.18)] md:p-8">
          <p className="text-sm font-medium text-white md:text-base">
            Service fee
          </p>
          <p className="mt-4 flex items-baseline gap-1">
            <span className="text-4xl font-normal tracking-tight text-white md:text-5xl">
              10%
            </span>
            <span className="text-sm text-white/70 md:text-base">
              service fee
            </span>
          </p>
          <ul className="mt-6 space-y-4">
            {INCLUDED.map((line) => (
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
