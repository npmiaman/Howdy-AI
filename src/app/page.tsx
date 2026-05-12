import { Star } from "lucide-react";

import { ContactDialog } from "@/components/contact-dialog";
import { Differentiation } from "@/components/differentiation";
import { FAQ } from "@/components/faq";
import { FinalCTA } from "@/components/final-cta";
import { HireButton } from "@/components/hire-button";
import { HireDialog } from "@/components/hire-dialog";
import { HowdyChatWidget } from "@/components/howdy-chat-widget";
import { HowItWorks } from "@/components/how-it-works";
import { MatchPreview } from "@/components/match-preview";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="company" />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-7xl px-4 pt-20 pb-2 sm:px-6 md:pt-24 md:pb-4 lg:pt-36 lg:pb-8">
          <Hero />
        </section>
        <section className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 md:pb-20 lg:pb-32">
          <MatchPreview />
          <StatStrip />
        </section>
        <HowItWorks />
        <Differentiation />
        <FinalCTA />
        <FAQ />
      </main>
      <SiteFooter />
      <HireDialog />
      <ContactDialog />
      <HowdyChatWidget />
    </div>
  );
}

function Hero() {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-balance text-3xl font-normal leading-[1.1] tracking-tight md:text-5xl lg:text-[4.25rem]">
        Hey, I&apos;m Howdy,
        <br />
        Your Freelance Talent Scout.
      </h1>

      <p className="mt-6 max-w-xl text-base text-white/70 md:mt-8 md:text-xl">
        Need a designer, developer, editor, or specialist? I&apos;ll find them,
        vet them, and make the intro.
      </p>

      <div className="mt-6 md:mt-8" id="message">
        <HireButton className="h-12 rounded-full border border-white/20 bg-white/10 px-7 text-sm font-medium text-white shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-sm hover:border-white/30 hover:bg-white/20 hover:text-white md:h-14 md:px-10 md:text-base">
          Start Hiring
        </HireButton>
      </div>
    </div>
  );
}

function StatStrip() {
  return (
    <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/70 md:text-base">
      <span>
        <span className="font-medium text-white">100+</span> vetted freelancers
      </span>
      <span aria-hidden className="size-1 rounded-full bg-white/30" />
      <span>Hand-picked matches</span>
      <span aria-hidden className="size-1 rounded-full bg-white/30" />
      <span className="flex items-center gap-2">
        <span className="flex">
          {Array.from({ length: 5 }).map((_, i) => {
            if (i < 4) {
              return (
                <Star
                  key={i}
                  className="size-3.5 fill-white text-white"
                />
              );
            }
            return (
              <span
                key={i}
                aria-hidden
                className="relative inline-block size-3.5"
              >
                <Star className="absolute inset-0 size-3.5 text-white/40" />
                <Star
                  className="absolute inset-0 size-3.5 fill-white text-white"
                  style={{ clipPath: "inset(0 50% 0 0)" }}
                />
              </span>
            );
          })}
        </span>
        <span>
          <span className="font-medium text-white">4.5</span> average rating
        </span>
      </span>
    </div>
  );
}
