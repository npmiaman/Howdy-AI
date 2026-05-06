import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "How fast is the first match really?",
    a: "Most matches arrive in under an hour. Complex briefs (specific stack, niche style, tight timezone) can take up to 24 hours.",
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
    a: "Designers, developers, video editors, motion artists, illustrators, writers, strategists, and most adjacent specialists. If you can describe the role, I can probably find it.",
  },
];

export function FAQ() {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-24 lg:py-32">
      <div className="mb-12 text-center">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
          FAQ
        </p>
        <h2 className="text-balance text-3xl leading-tight tracking-tight md:text-4xl lg:text-5xl">
          Things people ask
        </h2>
      </div>

      <div className="space-y-3">
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
    <details className="group rounded-xl border border-white/15 bg-white/5 px-6 py-4 backdrop-blur-md transition-colors open:bg-white/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <span className="text-base font-medium md:text-lg">{question}</span>
        <ChevronDown className="size-5 shrink-0 text-white/60 transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-3 text-sm text-white/70 md:text-base">{answer}</p>
    </details>
  );
}
