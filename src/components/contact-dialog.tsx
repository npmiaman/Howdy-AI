"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Mail, X } from "lucide-react";

const OPEN_EVENT = "howdy:open-contact-dialog";
const CONTACT_EMAIL = "tanashley37@gmail.com";

export function ContactDialog() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setCopied(false);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; user can still tap the address.
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
    >
      <button
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-6 text-white shadow-[0_8px_48px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <button
          onClick={() => setOpen(false)}
          aria-label="Close dialog"
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>

        <h2 className="text-xl tracking-tight md:text-2xl">Get in touch</h2>
        <p className="mt-2 text-sm text-white/70">
          Reach the team directly at the email below.
        </p>

        <div className="mt-5 flex items-center justify-between gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5">
          <span className="select-all truncate text-sm font-medium">
            {CONTACT_EMAIL}
          </span>
          <button
            onClick={copyEmail}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            {copied ? (
              <>
                <Check className="size-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy
              </>
            )}
          </button>
        </div>

        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-medium text-neutral-900 transition-colors hover:bg-white/90"
        >
          <Mail className="size-4" />
          Open in mail app
        </a>
      </div>
    </div>
  );
}

export function openContactDialog() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}
