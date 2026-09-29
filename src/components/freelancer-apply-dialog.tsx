"use client";

import { type ReactNode, useEffect, useId, useState } from "react";
import { X } from "lucide-react";

const OPEN_EVENT = "howdy:open-freelancer-apply-dialog";
const BIO_MAX = 600;

type FormState = {
  fullName: string;
  email: string;
  role: string;
  portfolioUrl: string;
  rateUsdPerHour: string;
  timezone: string;
  skills: string;
  bio: string;
  // Honeypot — hidden from people, so only bots fill it in.
  website: string;
};

const EMPTY: FormState = {
  fullName: "",
  email: "",
  role: "",
  portfolioUrl: "",
  rateUsdPerHour: "",
  timezone: "",
  skills: "",
  bio: "",
  website: "",
};

const LABELS: Record<string, string> = {
  fullName: "Full name",
  email: "Email",
  role: "What you do",
  portfolioUrl: "Portfolio link",
  rateUsdPerHour: "Hourly rate",
  timezone: "Timezone",
  skills: "Skills",
  bio: "About you",
};

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** Turn a 422 from the API into one readable line. */
function describeError(body: {
  error?: string;
  issues?: Array<{ path?: unknown[]; message?: string }>;
}): string {
  const issue = body.issues?.[0];
  if (issue?.message) {
    const label = LABELS[String(issue.path?.[0] ?? "")];
    return label ? `${label}: ${issue.message}` : issue.message;
  }
  return body.error ?? "Submission failed";
}

export function FreelancerApplyDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setStatus("idle");
      setErrorMsg(null);
      setForm((f) => (f.timezone ? f : { ...f, timezone: browserTimeZone() }));
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

  const set = (key: keyof FormState) => (v: string) =>
    setForm((f) => ({ ...f, [key]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !form.fullName.trim() ||
      !form.email.trim() ||
      !form.role.trim() ||
      !form.portfolioUrl.trim()
    )
      return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      const resp = await fetch("/api/freelancer-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(describeError(body));
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
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
    >
      {/* backdrop */}
      <button
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* card — scrolls on short screens, the form is longer than hire's */}
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-white/10 p-6 text-white shadow-[0_8px_48px_rgba(0,0,0,0.5)] backdrop-blur-md md:p-8">
        <button
          onClick={close}
          aria-label="Close dialog"
          className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>

        {status === "success" ? (
          <SuccessView
            titleId={titleId}
            name={form.fullName.trim().split(" ")[0]}
            onClose={close}
          />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <h2 id={titleId} className="text-2xl tracking-tight md:text-3xl">
                Request an invite.
              </h2>
              <p className="mt-2 text-sm text-white/70">
                Show us your work. A real person reviews every application,
                and we&apos;ll email you if it&apos;s a fit.
              </p>
            </div>

            <Field
              label={LABELS.fullName}
              name="fullName"
              placeholder="Maya Liu"
              value={form.fullName}
              onChange={set("fullName")}
              autoComplete="name"
              autoFocus
              required
            />
            <Field
              label={LABELS.email}
              name="email"
              type="email"
              placeholder="maya@studio.co"
              value={form.email}
              onChange={set("email")}
              autoComplete="email"
              required
            />
            <Field
              label={LABELS.role}
              name="role"
              placeholder="Video Editor"
              value={form.role}
              onChange={set("role")}
              required
            />
            <Field
              label={LABELS.portfolioUrl}
              name="portfolioUrl"
              inputMode="url"
              placeholder="behance.net/mayaliu"
              value={form.portfolioUrl}
              onChange={set("portfolioUrl")}
              autoComplete="url"
              required
            />
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Rate (USD/hr)"
                name="rateUsdPerHour"
                type="number"
                inputMode="decimal"
                placeholder="60"
                value={form.rateUsdPerHour}
                onChange={set("rateUsdPerHour")}
                min={1}
                step="any"
              />
              <Field
                label={LABELS.timezone}
                name="timezone"
                placeholder="Asia/Singapore"
                value={form.timezone}
                onChange={set("timezone")}
              />
            </div>
            <Field
              label={LABELS.skills}
              name="skills"
              placeholder="Premiere Pro, After Effects"
              value={form.skills}
              onChange={set("skills")}
              hint="Comma-separated"
            />

            <label className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between text-xs font-medium uppercase tracking-[0.14em] text-white/60">
                {LABELS.bio}
                <span className="normal-case tracking-normal text-white/40">
                  {form.bio.length}/{BIO_MAX}
                </span>
              </span>
              <textarea
                name="bio"
                rows={3}
                maxLength={BIO_MAX}
                placeholder="The kind of work you love and want more of."
                value={form.bio}
                onChange={(e) => set("bio")(e.target.value)}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:bg-white/10 focus:outline-none"
              />
            </label>

            {/* honeypot: off-screen, unfocusable, ignored by assistive tech */}
            <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
              <label>
                Website
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) => set("website")(e.target.value)}
                />
              </label>
            </div>

            {errorMsg && (
              <p role="alert" className="text-sm text-rose-300">
                Couldn&apos;t send: {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="mt-2 inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-base font-medium text-neutral-900 transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "submitting" ? "Sending…" : "Send Application"}
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
  inputMode,
  placeholder,
  value,
  onChange,
  required,
  autoFocus,
  autoComplete,
  hint,
  min,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  hint?: string;
  min?: number;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-white/60">
        {label}
        {required ? " *" : ""}
        {hint ? (
          <span className="ml-2 normal-case tracking-normal text-white/40">
            {hint}
          </span>
        ) : null}
      </span>
      <input
        type={type}
        name={name}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        min={min}
        step={step}
        className="h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:bg-white/10 focus:outline-none"
      />
    </label>
  );
}

function SuccessView({
  titleId,
  name,
  onClose,
}: {
  titleId: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <div role="status" className="flex flex-col gap-5 text-center">
      <h2 id={titleId} className="text-2xl tracking-tight md:text-3xl">
        {name ? `Got it, ${name}.` : "Got it."}
      </h2>
      <p className="text-sm text-white/70 md:text-base">
        Your application is in and a confirmation is on its way to your inbox.
        A real person reviews every one. If your work fits, we&apos;ll email
        you.
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

export function openFreelancerApplyDialog() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Drop-in trigger for Server Components (the freelancers page). */
export function FreelancerApplyButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={openFreelancerApplyDialog}
      className={className}
    >
      {children}
    </button>
  );
}
