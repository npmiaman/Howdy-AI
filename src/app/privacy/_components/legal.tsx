/**
 * Building blocks for the long-form legal pages (/privacy and /terms).
 * Shared by both pages; it lives under /privacy only because this change was
 * scoped to the two page folders. Move to src/components if it grows.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { ContactDialog } from "@/components/contact-dialog";
import { HireDialog } from "@/components/hire-dialog";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export type TocItem = { id: string; title: string };

export function LegalPage({
  title,
  intro,
  toc,
  children,
}: {
  title: string;
  intro: ReactNode;
  toc: TocItem[];
  children: ReactNode;
}) {
  return (
    <div className="relative z-0 flex min-h-screen flex-col overflow-x-clip text-zinc-900">
      {/* White page bg — covers the dark layout backdrop. */}
      <div aria-hidden className="fixed inset-0 -z-20 bg-white" />
      <SiteHeader theme="light" />
      <main className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6 md:pt-10 md:pb-24">
          <DraftBanner />

          <header className="mt-10 md:mt-14">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
              Legal
            </p>
            <h1 className="text-balance text-3xl leading-[1.05] tracking-tight md:text-5xl">
              {title}
            </h1>
            <div className="mt-5 space-y-4 text-base leading-relaxed text-zinc-600 md:text-lg">
              {intro}
            </div>
            <p className="mt-5 text-sm text-zinc-500">
              Last updated: <Placeholder>effective date</Placeholder>
            </p>
          </header>

          <nav
            aria-label="On this page"
            className="mt-10 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 md:mt-12 md:p-8"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
              On this page
            </p>
            <ol className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 md:text-base">
              {toc.map((item, i) => (
                <li key={item.id} className="flex gap-3">
                  <span className="w-5 shrink-0 tabular-nums text-zinc-400">
                    {i + 1}.
                  </span>
                  <a
                    href={`#${item.id}`}
                    className="text-zinc-700 underline-offset-4 transition-colors hover:text-zinc-950 hover:underline"
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-12 space-y-14 md:mt-16 md:space-y-16">
            {children}
          </div>
        </article>
        <SiteFooter />
      </main>
      <HireDialog />
      <ContactDialog />
    </div>
  );
}

function DraftBanner() {
  return (
    <div
      role="note"
      className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950 md:px-6"
    >
      <p className="text-sm font-semibold md:text-base">
        Draft — pending legal review.
      </p>
      <p className="mt-1 text-sm text-amber-900/80">
        This page hasn’t been reviewed by a lawyer yet. Anything marked
        [PLACEHOLDER] still needs a decision before it’s published.
      </p>
    </div>
  );
}

/** A visible gap for the reviewer to fill in. Renders "[PLACEHOLDER: …]". */
export function Placeholder({ children }: { children: string }) {
  return (
    <mark className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[0.85em] text-amber-900 ring-1 ring-amber-300 [box-decoration-break:clone]">
      [PLACEHOLDER: {children}]
    </mark>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2
        id={`${id}-title`}
        className="text-balance text-2xl leading-tight tracking-tight md:text-3xl"
      >
        {title}
      </h2>
      <div className="mt-5 space-y-5 text-base leading-relaxed text-zinc-600 md:text-[17px]">
        {children}
      </div>
    </section>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="pt-2 text-lg font-medium tracking-tight text-zinc-900 md:text-xl">
      {children}
    </h3>
  );
}

export function List({
  children,
  ordered = false,
}: {
  children: ReactNode;
  ordered?: boolean;
}) {
  const className = `space-y-3 pl-5 marker:text-zinc-400 ${
    ordered ? "list-decimal" : "list-disc"
  }`;
  return ordered ? (
    <ol className={className}>{children}</ol>
  ) : (
    <ul className={className}>{children}</ul>
  );
}

/** A list item that starts with a short bolded label. */
export function Item({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <li className="pl-1">
      {label && <span className="font-medium text-zinc-900">{label}. </span>}
      {children}
    </li>
  );
}

/** Two-column rows (label → detail) that stack on small screens. */
export function Rows({ rows }: { rows: Array<{ label: string; detail: ReactNode }> }) {
  return (
    <dl className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 bg-white px-5 py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6"
        >
          <dt className="font-medium text-zinc-900">{row.label}</dt>
          <dd>{row.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmailLink({ address }: { address: string }) {
  return (
    <a
      href={`mailto:${address}`}
      className="font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-700"
    >
      {address}
    </a>
  );
}

export function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-700"
    >
      {children}
    </Link>
  );
}

export const HOWDY_EMAIL = "howdyai@agentmail.to";
