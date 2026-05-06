"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const OPEN_EVENT = "howdy:open-hire-dialog";

type FormState = {
  fullName: string;
  company: string;
  position: string;
  email: string;
};

const EMPTY: FormState = {
  fullName: "",
  company: "",
  position: "",
  email: "",
};

export function HireDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setStatus("idle");
      setErrorMsg(null);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.trim() || !form.fullName.trim()) return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const resp = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.error ?? "Submission failed");
      }
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  function close() {
    setOpen(false);
    setTimeout(() => setForm(EMPTY), 200);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
    >
      {/* backdrop */}
      <button
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* card */}
      <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-white/10 p-6 text-white shadow-[0_8px_48px_rgba(0,0,0,0.5)] backdrop-blur-md md:p-8">
        <button
          onClick={close}
          aria-label="Close dialog"
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>

        {status === "success" ? (
          <SuccessView name={form.fullName.split(" ")[0]} onClose={close} />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl tracking-tight md:text-3xl">
                Tell me about yourself.
              </h2>
              <p className="mt-2 text-sm text-white/70">
                I&apos;ll send a quick note to your email so we can start
                figuring out who you need.
              </p>
            </div>

            <Field
              label="Full name"
              name="fullName"
              placeholder="Adheesh Goyal"
              value={form.fullName}
              onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
              autoFocus
              required
            />
            <Field
              label="Company"
              name="company"
              placeholder="Cognition"
              value={form.company}
              onChange={(v) => setForm((f) => ({ ...f, company: v }))}
            />
            <Field
              label="Your position"
              name="position"
              placeholder="Founder"
              value={form.position}
              onChange={(v) => setForm((f) => ({ ...f, position: v }))}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              placeholder="adheesh@cognition.com"
              value={form.email}
              onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              required
            />

            {errorMsg && (
              <p className="text-sm text-rose-300">Couldn&apos;t send: {errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="mt-2 inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-base font-medium text-neutral-900 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "submitting" ? "Sending…" : "Get Started"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  value,
  onChange,
  required,
  autoFocus,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-white/60">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        className="h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:bg-white/10 focus:outline-none"
      />
    </label>
  );
}

function SuccessView({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-5 text-center">
      <h2 className="text-2xl tracking-tight md:text-3xl">
        {name ? `You're in, ${name}.` : "You're in."}
      </h2>
      <p className="text-sm text-white/70 md:text-base">
        Check your inbox in a minute or two. Howdy will reach out to ask what
        you need built.
      </p>
      <button
        onClick={onClose}
        className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 bg-white/10 px-6 text-base font-medium text-white transition-colors hover:bg-white/20"
      >
        Done
      </button>
    </div>
  );
}

export function openHireDialog() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}
