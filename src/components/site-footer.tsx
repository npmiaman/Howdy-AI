import Image from "next/image";
import Link from "next/link";

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-4 py-6 sm:px-8 md:px-12 md:py-10 lg:px-16">
        <Link
          href="/"
          className="flex items-center gap-3 text-3xl font-medium tracking-tight md:gap-4 md:text-5xl lg:text-6xl"
        >
          <Image
            src="/howdy-logo.png"
            alt=""
            width={96}
            height={96}
            className="size-10 shrink-0 md:size-16 lg:size-20"
          />
          Howdy
        </Link>
        <nav aria-label="Legal" className="flex items-center gap-5 md:gap-6">
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 md:text-base"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
