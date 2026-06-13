"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type View = "card" | "minimized" | "open";

const FONT_CLASS = "font-[family-name:var(--font-inter)]";

const OPENING: ChatMessage = {
  role: "assistant",
  content:
    "Hey, I'm Howdy. Tell me what you're making and the creative you need — I'll start digging.",
};

export function HowdyChatWidget() {
  const [view, setView] = useState<View>("minimized");
  const [messages, setMessages] = useState<ChatMessage[]>([OPENING]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, view]);

  useEffect(() => {
    if (view === "open") inputRef.current?.focus();
  }, [view]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setView("minimized");
    }
    if (view === "open") window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || pending || done) return;
    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(next);
    setInput("");
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/howdy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Howdy is unreachable.");
      }
      const data = (await res.json()) as { reply: string; done?: boolean };
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.done) setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <>
      {/* Promo card */}
      {view === "card" && (
        <div
          className={`${FONT_CLASS} fixed bottom-4 right-4 z-50 w-[17rem] rounded-xl border border-white/40 bg-white/70 p-3.5 text-zinc-950 shadow-[0_12px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:bottom-6 sm:right-6`}
        >
          <div className="flex items-start justify-between gap-3">
            <Image
              src="/howdy-logo.png"
              alt=""
              width={56}
              height={56}
              className="size-12 shrink-0"
            />
            <button
              type="button"
              onClick={() => setView("minimized")}
              aria-label="Dismiss"
              className="-mr-1 -mt-1 flex size-6 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-black/5 hover:text-zinc-900"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <h3 className="mt-2.5 text-balance text-[13px] font-semibold leading-snug tracking-tight text-zinc-950">
            Talk to Howdy and get a feel for how it works.
          </h3>
          <button
            type="button"
            onClick={() => setView("open")}
            className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-zinc-950 px-4 text-[13px] font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Try now
          </button>
          <p className="mt-1.5 text-center text-[11px] text-zinc-600">
            No signup needed
          </p>
        </div>
      )}

      {/* Minimized bubble */}
      {view === "minimized" && (
        <button
          type="button"
          onClick={() => setView("open")}
          aria-label="Talk to Howdy"
          className={`${FONT_CLASS} fixed bottom-4 right-4 z-50 flex size-14 items-center justify-center rounded-full bg-white/60 shadow-[0_8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-zinc-200/80 backdrop-blur-md transition-transform hover:-translate-y-0.5 sm:bottom-6 sm:right-6`}
        >
          <Image
            src="/howdy-logo.png"
            alt=""
            width={56}
            height={56}
            className="size-9"
          />
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-[3px] border-white bg-emerald-500"
          />
        </button>
      )}

      {/* Expanded chat panel */}
      {view === "open" && (
        <div
          className={`${FONT_CLASS} fixed bottom-4 right-4 z-50 flex h-[min(560px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-50 shadow-2xl sm:bottom-6 sm:right-6`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-white/30 backdrop-blur-md">
                <Image
                  src="/howdy-logo.png"
                  alt=""
                  width={36}
                  height={36}
                  className="size-6"
                />
                <span
                  aria-hidden
                  className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-[3px] border-zinc-950 bg-emerald-500"
                />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">
                  Howdy
                </div>
                <div className="mt-0.5 text-xs text-zinc-400">
                  Online · No signup needed
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setView("minimized")}
              aria-label="Close chat"
              className="flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-50"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role} content={m.content} />
            ))}
            {pending && <Bubble role="assistant" content="…" typing />}
            {error && (
              <div className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            {done && !pending && (
              <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                That&apos;s the demo. To use the real thing, email{" "}
                <a
                  href="mailto:howdyai@agentmail.to"
                  className="text-zinc-100 underline-offset-4 hover:underline"
                >
                  howdyai@agentmail.to
                </a>
                .
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 p-3">
            <div className="flex items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 focus-within:border-zinc-600">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                disabled={pending || done}
                placeholder={
                  done
                    ? "Demo ended"
                    : pending
                      ? "Howdy is thinking…"
                      : "Tell Howdy what you need…"
                }
                className="max-h-32 flex-1 resize-none bg-transparent text-sm text-zinc-50 placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={pending || done || !input.trim()}
                aria-label="Send"
                className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-50 text-zinc-900 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({
  role,
  content,
  typing,
}: {
  role: "user" | "assistant";
  content: string;
  typing?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-50 text-zinc-900"
            : "border border-zinc-800 bg-zinc-900 text-zinc-100"
        }`}
      >
        {typing ? (
          <span className="inline-flex gap-1">
            <span className="size-1.5 animate-pulse rounded-full bg-zinc-500" />
            <span className="size-1.5 animate-pulse rounded-full bg-zinc-500 [animation-delay:120ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-zinc-500 [animation-delay:240ms]" />
          </span>
        ) : (
          content
        )}
      </div>
    </div>
  );
}
