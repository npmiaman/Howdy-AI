import Image from "next/image";
import { ArrowUpRight, Sparkles, Star } from "lucide-react";

import { ContactDialog } from "@/components/contact-dialog";
import { Differentiation } from "@/components/differentiation";
import { FAQ } from "@/components/faq";
import { FinalCTA } from "@/components/final-cta";
import { HireButton } from "@/components/hire-button";
import { HireDialog } from "@/components/hire-dialog";
import { HowItWorks } from "@/components/how-it-works";
import { HomeChrome } from "@/components/home-chrome";
import { MatchPreview } from "@/components/match-preview";
import { SiteFooter } from "@/components/site-footer";

export default function Home() {
  return (
    <div className="relative z-0 flex min-h-screen flex-col overflow-x-clip text-zinc-900">
      {/* White page bg — covers the dark layout backdrop. */}
      <div aria-hidden className="fixed inset-0 -z-20 bg-white" />
      <HomeChrome />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 pt-4 sm:px-10 md:px-14 md:pt-6 md:pb-6">
          <HeroCard />
        </section>
        <section className="mx-auto w-full max-w-7xl px-4 pt-10 pb-12 sm:px-6 md:pt-14 md:pb-16">
          <StatStrip />
        </section>
        <HowItWorks />
        <Differentiation />
        <FinalCTA />
        <FAQ />
        <SiteFooter />
      </main>
      <HireDialog />
      <ContactDialog />
    </div>
  );
}

function HeroCard() {
  return (
    <div className="relative overflow-hidden rounded-[28px] md:rounded-[36px]">
      <Image
        src="/bg.jpg"
        alt=""
        fill
        priority
        sizes="(min-width: 1400px) 1400px, 100vw"
        className="object-cover"
        style={{ filter: "blur(1.5px)" }}
      />
      <div aria-hidden className="absolute inset-0 bg-black/20" />
      <div className="relative flex flex-col items-center px-5 py-9 text-center md:px-8 md:py-11 lg:py-12">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/[0.12] px-4 py-1.5 text-xs font-medium text-white shadow-[0_4px_18px_rgba(0,0,0,0.18)] backdrop-blur-md">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          Scouting creatives now
          <Sparkles className="size-3" />
        </span>

        <h1 className="mt-7 max-w-4xl text-balance text-3xl font-normal leading-[1.05] tracking-tight text-white md:mt-9 md:text-5xl lg:text-6xl">
          Hey, I&apos;m Howdy,
          <br />
          Your Creative Talent Scout.
        </h1>

        <p className="mt-4 max-w-xl text-balance text-sm leading-relaxed text-white/85 md:mt-5 md:text-base">
          Need a brand designer, video editor, motion artist, or
          illustrator? I&apos;ll find them, vet them, and make the intro.
        </p>

        <div className="mt-6 md:mt-8" id="message">
          <HireButton className="flex h-11 items-center gap-1 rounded-full border border-white/30 bg-white/15 pl-5 pr-1 text-sm font-medium text-white shadow-[0_10px_36px_rgba(0,0,0,0.2)] backdrop-blur-md transition-colors hover:border-white/40 hover:bg-white/25 hover:text-white md:h-13 md:pl-7 md:text-base">
            <span>Start Hiring</span>
            <span className="flex size-9 items-center justify-center rounded-full border border-white/25 bg-white/20 text-white backdrop-blur-md md:size-11">
              <ArrowUpRight className="size-4 md:size-5" />
            </span>
          </HireButton>
        </div>

        <div className="mt-8 w-full max-w-2xl text-left md:mt-10">
          <MatchPreview />
        </div>
      </div>
    </div>
  );
}

function StatStrip() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-zinc-600 md:text-base">
      <span>
        <span className="font-medium text-zinc-900">100+</span> vetted creatives
      </span>
      <span aria-hidden className="size-1 rounded-full bg-zinc-300" />
      <span>Hand-picked matches</span>
      <span aria-hidden className="size-1 rounded-full bg-zinc-300" />
      <span className="flex items-center gap-2">
        <span className="flex">
          {Array.from({ length: 5 }).map((_, i) => {
            if (i < 4) {
              return (
                <Star
                  key={i}
                  className="size-3.5 fill-zinc-900 text-zinc-900"
                />
              );
            }
            return (
              <span
                key={i}
                aria-hidden
                className="relative inline-block size-3.5"
              >
                <Star className="absolute inset-0 size-3.5 text-zinc-300" />
                <Star
                  className="absolute inset-0 size-3.5 fill-zinc-900 text-zinc-900"
                  style={{ clipPath: "inset(0 50% 0 0)" }}
                />
              </span>
            );
          })}
        </span>
        <span>
          <span className="font-medium text-zinc-900">4.5</span> average rating
        </span>
      </span>
    </div>
  );
}
