"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ContactButton } from "@/components/contact-button";
import { HireButton } from "@/components/hire-button";

type Variant = "company" | "freelancer";

const INVITE_MAILTO =
  "mailto:howdyai@agentmail.to?subject=Request%20to%20join%20Howdy%27s%20freelancer%20roster";

const CTA_BASE =
  "h-9 rounded-full px-4 text-sm font-medium shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-colors md:h-12 md:px-7 md:text-base";

const CTA_AT_TOP =
  "border border-white/20 bg-white/10 text-white hover:border-white/30 hover:bg-white/20 hover:text-white";

const CTA_SCROLLED =
  "border border-transparent bg-white text-zinc-950 hover:bg-white/90 hover:text-zinc-950";

export function SiteHeader({ variant = "company" }: { variant?: Variant }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const crossLink =
    variant === "company"
      ? { href: "/freelancers", label: "For Freelancers" }
      : { href: "/", label: "For Companies" };

  const ctaClass = `${CTA_BASE} ${scrolled ? CTA_SCROLLED : CTA_AT_TOP}`;

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-8 md:px-12 md:py-6 lg:px-16">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-medium tracking-tight md:text-2xl"
        >
          <Image
            src="/howdy-logo.png"
            alt=""
            width={48}
            height={48}
            className="size-8 shrink-0 invert mix-blend-screen md:size-11"
          />
          Howdy
        </Link>
        <div className="flex items-center gap-2 md:gap-3">
          <Link
            href={crossLink.href}
            className="hidden h-9 items-center px-3 text-sm font-medium text-white/80 transition-colors hover:text-white sm:inline-flex md:h-12 md:px-4 md:text-base"
          >
            {crossLink.label}
          </Link>
          <ContactButton className="h-9 px-3 text-sm font-medium text-white/80 transition-colors hover:bg-transparent hover:text-white md:h-12 md:px-4 md:text-base">
            Get in touch
          </ContactButton>
          {variant === "company" ? (
            <HireButton className={ctaClass}>Hire Talent</HireButton>
          ) : (
            <a
              href={INVITE_MAILTO}
              className={`inline-flex items-center justify-center ${ctaClass}`}
            >
              Request Invite
            </a>
          )}
        </div>
      </nav>
    </header>
  );
}
