import { ChevronDown } from "lucide-react";

import { BLOB_ASCII } from "@/lib/ascii-art";

const FAQS = [
  {
    q: "How fast is the first match really?",
    a: "Most matches arrive in under an hour. Complex briefs (niche aesthetic, rare medium, tight timezone) can take up to 24 hours.",
  },
  {
    q: "What if the match isn't right?",
    a: "Just tell me. I'll send another, free of charge, until you find someone who fits. There's no penalty for saying no.",
  },
  {
    q: "Who pays whom?",
    a: "You pay the freelancer directly at their agreed rate. No bidding wars, no hidden margins on the work itself.",
  },
  {
    q: "Are there platform fees on the work?",
    a: "We don't charge any fees, and we provide a free trial so you can run Howdy commitment-free. If you want to keep using Howdy after your first hire, there's a monthly subscription that gives you access to premium tools and hiring.",
  },
  {
    q: "Can I rehire the same freelancer for a new project?",
    a: "Absolutely. Message me with what you need next and I'll loop them straight back in, no re-vetting required.",
  },
  {
    q: "What roles do you actually cover?",
    a: "Brand and product designers, video editors, motion artists, illustrators, animators, copywriters, content strategists, and most adjacent creative specialists. If you can describe the role, I can probably find it.",
  },
];

export function FAQ() {
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
          Things people ask
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
    <details className="group rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-4 backdrop-blur-md transition-colors open:bg-zinc-100">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="text-base font-medium md:text-lg">{question}</span>
        <ChevronDown className="size-5 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-3 text-sm text-zinc-600 md:text-base">{answer}</p>
    </details>
  );
}
