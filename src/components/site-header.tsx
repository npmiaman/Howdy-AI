"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ContactButton } from "@/components/contact-button";
import { HireButton } from "@/components/hire-button";

type Variant = "company" | "freelancer";
type Theme = "glass" | "light";

const INVITE_MAILTO =
  "mailto:howdyai@agentmail.to?subject=Request%20to%20join%20Howdy%27s%20freelancer%20roster";

const CTA_BASE =
  "h-9 rounded-full px-4 text-sm font-medium shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-colors md:h-12 md:px-7 md:text-base";

const CTA_AT_TOP =
  "border border-white/20 bg-white/10 text-white hover:border-white/30 hover:bg-white/20 hover:text-white";

const CTA_SCROLLED =
  "border border-transparent bg-white text-zinc-950 hover:bg-white/90 hover:text-zinc-950";

const CTA_LIGHT =
  "border border-transparent bg-zinc-950 text-white hover:bg-zinc-800 hover:text-white";

const CTA_LIGHT_SCROLLED =
  "h-8 rounded-full border border-transparent bg-white px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 hover:text-zinc-950 md:h-9 md:px-4 md:text-sm";

export function SiteHeader({
  variant = "company",
  theme = "glass",
  offsetForBanner = false,
}: {
  variant?: Variant;
  theme?: Theme;
  offsetForBanner?: boolean;
}) {
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

  const isLight = theme === "light";
  const isPill = isLight && scrolled;

  const ctaClass = isLight
    ? isPill
      ? CTA_LIGHT_SCROLLED
      : `${CTA_BASE} ${CTA_LIGHT}`
    : `${CTA_BASE} ${scrolled ? CTA_SCROLLED : CTA_AT_TOP}`;

  const logoImgClass = isLight
    ? isPill
      ? "size-7 shrink-0 invert mix-blend-screen md:size-8"
      : "size-8 shrink-0 md:size-11"
    : "size-8 shrink-0 invert mix-blend-screen md:size-11";
  const linkClass = isLight
    ? isPill
      ? "hidden h-8 items-center px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:text-white sm:inline-flex md:px-3 md:text-sm"
      : "hidden h-9 items-center px-3 text-sm font-medium text-zinc-700 transition-colors hover:text-zinc-950 sm:inline-flex md:h-12 md:px-4 md:text-base"
    : "hidden h-9 items-center px-3 text-sm font-medium text-white/80 transition-colors hover:text-white sm:inline-flex md:h-12 md:px-4 md:text-base";
  const contactClass = isLight
    ? isPill
      ? "h-8 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-transparent hover:text-white md:px-3 md:text-sm"
      : "h-9 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-transparent hover:text-zinc-950 md:h-12 md:px-4 md:text-base"
    : "h-9 px-3 text-sm font-medium text-white/80 transition-colors hover:bg-transparent hover:text-white md:h-12 md:px-4 md:text-base";

  const navClass = isLight
    ? isPill
      ? "mx-auto mt-2 flex w-full max-w-3xl items-center justify-between rounded-full border border-zinc-700/60 bg-zinc-800/95 px-3 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-md transition-all duration-300 ease-out sm:px-4 md:mt-3 md:py-2"
      : "mx-auto flex w-full max-w-7xl items-center justify-between rounded-full border border-transparent bg-transparent px-4 py-4 shadow-none transition-all duration-300 ease-out sm:px-8 md:px-12 md:py-6 lg:px-16"
    : "mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-8 md:px-12 md:py-6 lg:px-16";

  const logoLinkClass = isLight
    ? isPill
      ? "flex items-center gap-2 text-base font-medium tracking-tight text-white transition-colors md:text-lg"
      : "flex items-center gap-2 text-lg font-medium tracking-tight text-zinc-950 transition-colors md:text-2xl"
    : "flex items-center gap-2 text-lg font-medium tracking-tight md:text-2xl";

  return (
    <header
      className={
        isLight
          ? `sticky inset-x-0 ${offsetForBanner ? "top-10" : "top-0"} z-50 px-3 sm:px-4`
          : "fixed inset-x-0 top-0 z-50"
      }
    >
      <nav className={navClass}>
        <Link href="/" className={logoLinkClass}>
          <Image
            src="/howdy-logo.png"
            alt=""
            width={48}
            height={48}
            className={logoImgClass}
          />
          Howdy
        </Link>
        <div className="flex items-center gap-2 md:gap-3">
          {variant === "freelancer" && (
            <Link href={crossLink.href} className={linkClass}>
              {crossLink.label}
            </Link>
          )}
          <ContactButton className={contactClass}>
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
