"use client";

import Image from "next/image";
import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  Forward,
  Mail,
  Mic,
  MoreVertical,
  Phone,
  Plus,
  Reply,
  Search,
  Smile,
  Star,
  Trash2,
  Video,
  X,
} from "lucide-react";

export type Attachment = {
  name: string;
  size: string;
  kind: "pdf" | "image" | "audio" | "figma";
};

export type EmailMessage = {
  from: string;
  email: string;
  initial: string;
  color: string;
  direction: "incoming" | "outgoing";
  time: string;
  body: React.ReactNode;
  snippet: string;
  attachments?: Attachment[];
  avatarSrc?: string;
  avatarBlend?: boolean;
};

export function EmailThread({
  subject,
  messages,
  currentStep,
}: {
  subject: string;
  messages: EmailMessage[];
  currentStep: number;
}) {
  const [tab, setTab] = useState<"gmail" | "whatsapp">("gmail");
  const safeStep = Math.max(0, Math.min(messages.length - 1, currentStep));
  const visible = messages.slice(0, safeStep + 1);
  const collapsed = visible.slice(0, -1);
  const expanded = visible[visible.length - 1];
  const isLastStep = safeStep === messages.length - 1;

  // Map email progress onto the WhatsApp thread so the scroll-step
  // animation drives both tabs (e.g. 4 email steps -> 6 chat bubbles).
  const waVisible = Math.max(
    1,
    Math.ceil(((safeStep + 1) / messages.length) * WA_MESSAGES.length),
  );

  if (tab === "whatsapp") {
    return (
      <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl bg-white font-[system-ui,sans-serif] text-[#202124] shadow-2xl ring-1 ring-black/10">
        <BrowserChrome active="whatsapp" onSelect={setTab} />
        <WhatsAppPanel visibleCount={waVisible} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl bg-white font-[system-ui,sans-serif] text-[#202124] shadow-2xl ring-1 ring-black/10">
      {/* macOS browser chrome */}
      <BrowserChrome active="gmail" onSelect={setTab} />

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-2 py-1 md:px-3 md:py-1.5">
        <div className="flex items-center gap-0.5 text-neutral-600">
          <ToolbarButton>
            <ArrowLeft className="size-4 md:size-5" />
          </ToolbarButton>
          <span className="mx-1.5 h-4 w-px bg-neutral-200 md:mx-2 md:h-5" />
          <ToolbarButton>
            <Archive className="size-4 md:size-5" />
          </ToolbarButton>
          <ToolbarButton>
            <Trash2 className="size-4 md:size-5" />
          </ToolbarButton>
          <ToolbarButton>
            <Mail className="size-4 md:size-5" />
          </ToolbarButton>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-neutral-500 md:text-xs">
            1 of 423
          </span>
          <ToolbarButton>
            <MoreVertical className="size-4 md:size-5" />
          </ToolbarButton>
        </div>
      </div>

      {/* Subject */}
      <div className="flex items-start justify-between gap-2 px-3 pb-2 pt-3 md:gap-3 md:px-5 md:pb-3 md:pt-4">
        <div className="flex flex-wrap items-start gap-1.5 md:gap-2">
          <h2 className="text-[14px] font-normal leading-tight md:text-[18px]">
            {subject}
          </h2>
          <span className="mt-0.5 inline-flex items-center rounded border border-neutral-300 px-1 py-0.5 text-[9px] text-neutral-700 md:mt-1 md:px-1.5 md:text-[10px]">
            Inbox
          </span>
        </div>
        <Star className="mt-1 size-3.5 shrink-0 text-neutral-400 md:mt-1.5 md:size-4" />
      </div>

      {/* Collapsed messages (all but the latest) */}
      {collapsed.map((msg, i) => (
        <CollapsedEmail key={i} message={msg} />
      ))}

      {/* Expanded latest message; re-mounts on step change to retrigger animation */}
      <ExpandedEmail key={safeStep} message={expanded} />

      {/* Action buttons; only after final step */}
      {isLastStep && (
        <div className="flex animate-in fade-in gap-2 border-t border-neutral-100 px-5 pb-5 pt-3 duration-700">
          <ActionButton>
            <Reply className="size-3.5" />
            Reply
          </ActionButton>
          <ActionButton>
            <Forward className="size-3.5" />
            Forward
          </ActionButton>
        </div>
      )}
    </div>
  );
}

export function BrowserChrome({
  active = "gmail",
  onSelect,
}: {
  active?: "gmail" | "whatsapp";
  onSelect?: (tab: "gmail" | "whatsapp") => void;
}) {
  return (
    <div className="flex items-end gap-2 bg-[#e8e8e8] px-2 pt-2 md:gap-3 md:px-3 md:pt-3">
      <div className="flex items-center gap-1 pb-1.5 md:gap-1.5 md:pb-2.5">
        <span className="size-2.5 rounded-full bg-[#FF5F57] md:size-3" />
        <span className="size-2.5 rounded-full bg-[#FEBC2E] md:size-3" />
        <span className="size-2.5 rounded-full bg-[#28C840] md:size-3" />
      </div>
      <BrowserTab
        label="Gmail"
        isActive={active === "gmail"}
        onClick={() => onSelect?.("gmail")}
        icon={
          <Image
            src="/gmail-icon.png"
            alt="Gmail"
            width={20}
            height={20}
            className="size-4 shrink-0 md:size-5"
          />
        }
      />
      <BrowserTab
        label="WhatsApp"
        isActive={active === "whatsapp"}
        onClick={() => onSelect?.("whatsapp")}
        icon={<WhatsAppGlyph />}
      />
    </div>
  );
}

function BrowserTab({
  label,
  icon,
  isActive,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-ml-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-t-md pl-2 pr-1.5 text-[11px] font-medium md:-ml-2 md:h-9 md:gap-2 md:pl-3 md:pr-2 md:text-[13px] ${
        isActive
          ? "bg-white text-neutral-700"
          : "bg-transparent text-neutral-500 hover:bg-white/50"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className="ml-0.5 flex size-3.5 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 md:ml-1 md:size-4">
        <X className="size-2.5 md:size-3" strokeWidth={2.25} />
      </span>
    </button>
  );
}

// Simple green chat-bubble glyph standing in for the WhatsApp icon.
function WhatsAppGlyph() {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#25D366] md:size-5">
      <Phone className="size-2 fill-white text-white md:size-2.5" />
    </span>
  );
}

function ToolbarButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-100">
      {children}
    </button>
  );
}

function ActionButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-[13px] text-neutral-700 transition-colors hover:bg-neutral-100">
      {children}
    </button>
  );
}

function CollapsedEmail({ message }: { message: EmailMessage }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 border-t border-neutral-200 px-3 py-2 text-left transition-colors hover:bg-neutral-50 md:gap-3 md:px-5 md:py-3"
    >
      <div
        className={`flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white shadow-sm md:size-8 md:text-[12px] ${message.color}`}
      >
        {message.avatarSrc ? (
          <Image
            src={message.avatarSrc}
            alt=""
            width={32}
            height={32}
            className={`size-full object-cover ${
              message.avatarBlend ? "invert mix-blend-screen scale-125" : ""
            }`}
          />
        ) : (
          message.initial
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 md:gap-2">
        <span className="shrink-0 text-[11px] font-semibold text-neutral-900 md:text-[13px]">
          {message.from}
        </span>
        <span className="truncate text-[10px] text-neutral-500 md:text-[12px]">
          {message.snippet}
        </span>
      </div>
      <span className="shrink-0 text-[9px] text-neutral-500 md:text-[11px]">
        {message.time}
      </span>
    </button>
  );
}

function ExpandedEmail({ message }: { message: EmailMessage }) {
  const slideClass =
    message.direction === "outgoing"
      ? "slide-in-from-right-8"
      : "slide-in-from-left-8";

  return (
    <div
      className={`border-t border-neutral-200 px-3 pb-4 pt-3 animate-in fade-in ${slideClass} duration-500 md:px-5 md:pb-5 md:pt-4`}
    >
      <div className="flex items-start gap-2 md:gap-3">
        <div
          className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold text-white shadow-sm md:size-10 md:text-[13px] ${message.color}`}
        >
          {message.avatarSrc ? (
            <Image
              src={message.avatarSrc}
              alt=""
              width={40}
              height={40}
              className={`size-full object-cover ${
                message.avatarBlend
                  ? "invert mix-blend-screen scale-125"
                  : ""
              }`}
            />
          ) : (
            message.initial
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[11px] leading-snug md:text-[13px]">
              <span className="font-semibold text-neutral-900">
                {message.from}
              </span>{" "}
              <span className="text-neutral-500">&lt;{message.email}&gt;</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 md:gap-2 md:text-[11px]">
              <span className="hidden sm:inline">{message.time}</span>
              <Star className="size-3 text-neutral-400 md:size-3.5" />
              <Reply className="size-3 md:size-3.5" />
              <MoreVertical className="size-3 md:size-3.5" />
            </div>
          </div>

          <div className="mt-2 space-y-2 text-[12px] leading-relaxed md:mt-3 md:space-y-2.5 md:text-[13px]">
            {message.body}
          </div>

          {message.attachments && message.attachments.length > 0 && (
            <Attachments attachments={message.attachments} />
          )}
        </div>
      </div>
    </div>
  );
}

function Attachments({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="mt-5">
      <div className="mb-2 text-[11px] text-neutral-500">
        {attachments.length}{" "}
        {attachments.length === 1 ? "Attachment" : "Attachments"}
        {" · "}
        <span className="text-neutral-500">Scanned by Gmail</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((file) => (
          <AttachmentCard key={file.name} file={file} />
        ))}
      </div>
    </div>
  );
}

function AttachmentCard({ file }: { file: Attachment }) {
  return (
    <div className="group flex h-[58px] w-[228px] items-center gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 transition-all hover:border-neutral-300 hover:shadow-sm">
      <FileIcon kind={file.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight text-neutral-800">
          {file.name}
        </div>
        <div className="mt-0.5 text-[11px] text-neutral-500">{file.size}</div>
      </div>
    </div>
  );
}

function FileIcon({ kind }: { kind: Attachment["kind"] }) {
  const meta = attachmentStyles[kind];
  return (
    <div className="relative shrink-0">
      <div
        className={`flex h-9 w-7 flex-col items-center justify-end overflow-hidden rounded-[3px] pb-0.5 ${meta.bg}`}
      >
        <span className="text-[7px] font-bold tracking-wide text-white">
          {meta.label}
        </span>
      </div>
      <div
        className="absolute right-0 top-0 size-2 bg-white"
        style={{ clipPath: "polygon(0 0, 100% 100%, 100% 0)" }}
      />
    </div>
  );
}

const attachmentStyles: Record<
  Attachment["kind"],
  { bg: string; label: string }
> = {
  pdf: { bg: "bg-[#DB4437]", label: "PDF" },
  image: { bg: "bg-[#0F9D58]", label: "PNG" },
  audio: { bg: "bg-[#4285F4]", label: "MP3" },
  figma: { bg: "bg-[#A142F4]", label: "FIG" },
};

/* ---------------------------------------------------------------------------
 * WhatsApp tab — same scenario energy as the email thread, different brief.
 * ------------------------------------------------------------------------- */

type WaAttachment =
  | { kind: "document"; name: string; size: string }
  | { kind: "image"; caption?: string };

type WaMessage = {
  direction: "incoming" | "outgoing";
  text?: React.ReactNode;
  attachment?: WaAttachment;
  time: string;
};

const WA_MESSAGES: WaMessage[] = [
  {
    direction: "outgoing",
    text: "Hey Howdy — need an editor for our launch film 🎬 90-sec hero film for the homepage.",
    time: "10:14",
  },
  {
    direction: "incoming",
    text: "On it! Quick Qs — style, deadline, footage, any refs?",
    time: "10:16",
  },
  {
    direction: "outgoing",
    text: "Linear/Apple style, 2-week deadline, ~30 min of raw footage. Light motion graphics + original sound.",
    time: "10:31",
  },
  {
    direction: "outgoing",
    attachment: { kind: "document", name: "brand-guidelines.pdf", size: "4.2 MB" },
    time: "10:31",
  },
  {
    direction: "outgoing",
    attachment: { kind: "image", caption: "Moodboard for the vibe ✨" },
    time: "10:32",
  },
  {
    direction: "incoming",
    text: "Perfect — got the guidelines + moodboard. Finding your match now.",
    time: "10:33",
  },
  {
    direction: "incoming",
    text: (
      <>
        Match: <strong>Leo Tan</strong> — 7 yrs, launch films for Linear-style
        brands. $40/hr, free Thursday. Reel: leotan.work
      </>
    ),
    time: "10:58",
  },
];

// Faint doodle pattern for the chat backdrop.
const WA_PATTERN =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='0.045' stroke-width='1.2'%3E%3Ccircle cx='18' cy='22' r='5'/%3E%3Cpath d='M86 14l8 8m0-8l-8 8'/%3E%3Ccircle cx='62' cy='58' r='3'/%3E%3Cpath d='M22 84c4-6 12-6 16 0'/%3E%3Cpath d='M96 92l6 6m0-6l-6 6'/%3E%3Ccircle cx='44' cy='108' r='4'/%3E%3C/g%3E%3C/svg%3E")`;

function WhatsAppPanel({ visibleCount }: { visibleCount: number }) {
  const visible = WA_MESSAGES.slice(0, visibleCount);
  return (
    <div className="flex flex-col">
      {/* Chat header */}
      <div className="flex items-center justify-between border-b border-black/5 bg-[#f0f2f5] px-3 py-1.5 md:px-4 md:py-2">
        <div className="flex items-center gap-2.5 md:gap-3">
          <div className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-black ring-1 ring-black/10 md:size-9">
            <Image
              src="/howdy-logo.png"
              alt=""
              width={40}
              height={40}
              className="size-full scale-125 object-cover invert mix-blend-screen"
            />
          </div>
          <div className="leading-tight">
            <div className="text-[12px] font-semibold text-[#111b21] md:text-[14px]">
              Howdy
            </div>
            <div className="text-[10px] leading-tight text-[#667781] md:text-[11px]">
              online
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[#54656f] md:gap-5">
          <Video className="size-4 md:size-[18px]" strokeWidth={1.75} />
          <Phone className="size-3.5 md:size-4" strokeWidth={1.75} />
          <Search className="size-3.5 md:size-4" strokeWidth={1.75} />
          <MoreVertical className="size-4 md:size-[18px]" strokeWidth={1.75} />
        </div>
      </div>

      {/* Messages */}
      <div
        className="space-y-1 bg-[#efeae2] px-4 pb-4 pt-3 md:space-y-1.5 md:px-9 md:pb-5 md:pt-4"
        style={{ backgroundImage: WA_PATTERN }}
      >
        <div className="flex justify-center pb-2">
          <span className="rounded-lg bg-white px-2.5 py-1 text-[9px] font-medium uppercase tracking-wide text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] md:text-[10px]">
            Today
          </span>
        </div>
        {visible.map((m, i) => (
          <WaBubble
            key={i}
            message={m}
            isLatest={i === visible.length - 1}
            showTail={i === 0 || WA_MESSAGES[i - 1].direction !== m.direction}
          />
        ))}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2.5 border-t border-black/5 bg-[#f0f2f5] px-3 py-2 text-[#54656f] md:gap-4 md:px-4 md:py-2.5">
        <Plus className="size-4.5 md:size-6" strokeWidth={1.5} />
        <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-1.5 md:px-4 md:py-2">
          <Smile className="size-4 shrink-0 text-[#8696a0] md:size-5" strokeWidth={1.75} />
          <span className="text-[11px] text-[#8696a0] md:text-[13px]">
            Type a message
          </span>
        </div>
        <Mic className="size-4 md:size-5" strokeWidth={1.75} />
      </div>
    </div>
  );
}

function WaBubble({
  message,
  isLatest,
  showTail,
}: {
  message: WaMessage;
  isLatest: boolean;
  showTail: boolean;
}) {
  const isOut = message.direction === "outgoing";
  const att = message.attachment;
  return (
    <div
      className={`flex ${isOut ? "justify-end" : "justify-start"} ${
        isLatest
          ? `animate-in fade-in duration-500 ${
              isOut ? "slide-in-from-right-6" : "slide-in-from-left-6"
            }`
          : ""
      }`}
    >
      <div
        className={`relative max-w-[80%] rounded-lg p-1 text-[11px] leading-[1.35] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] md:max-w-[68%] md:text-[13px] ${
          isOut ? "bg-[#d9fdd3]" : "bg-white"
        } ${showTail ? (isOut ? "rounded-tr-none" : "rounded-tl-none") : ""}`}
      >
        {/* bubble tail */}
        {showTail && (
          <svg
            viewBox="0 0 8 13"
            className={`absolute top-0 h-[13px] w-2 ${
              isOut
                ? "-right-2 text-[#d9fdd3]"
                : "-left-2 scale-x-[-1] text-white"
            }`}
            aria-hidden
          >
            <path d="M0 0 L8 0 L0 10 Z" fill="currentColor" />
          </svg>
        )}

        {att?.kind === "document" && <WaDocCard name={att.name} size={att.size} />}
        {att?.kind === "image" && <WaMoodboard />}

        {message.text && (
          <div className="px-1.5 pt-1">{message.text}</div>
        )}
        {att?.kind === "image" && att.caption && (
          <div className="px-1.5 pt-1">{att.caption}</div>
        )}

        <div className="flex items-center justify-end gap-1 px-1.5 pb-0.5 pt-0.5 text-[8px] leading-none text-[#667781] md:text-[10px]">
          {message.time}
          {isOut && (
            <CheckCheck className="size-3 text-[#53bdeb] md:size-3.5" strokeWidth={2} />
          )}
        </div>
      </div>
    </div>
  );
}

// WhatsApp document share — a tappable file row inside the bubble.
function WaDocCard({ name, size }: { name: string; size: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-black/[0.06] px-2.5 py-2">
      <div className="relative shrink-0">
        <div className="flex h-9 w-7 flex-col items-center justify-end rounded-[3px] bg-[#DB4437] pb-0.5">
          <span className="text-[7px] font-bold tracking-wide text-white">PDF</span>
        </div>
        <div
          className="absolute right-0 top-0 size-2 bg-white"
          style={{ clipPath: "polygon(0 0, 100% 100%, 100% 0)" }}
        />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-[#111b21] md:text-[12.5px]">
          {name}
        </div>
        <div className="mt-0.5 text-[9px] text-[#667781] md:text-[10px]">
          {size} · PDF
        </div>
      </div>
    </div>
  );
}

// WhatsApp image share — a small moodboard collage standing in for a photo.
function WaMoodboard() {
  const tiles = [
    "from-indigo-500 to-purple-600",
    "from-zinc-700 to-zinc-950",
    "from-sky-400 to-blue-600",
    "from-rose-400 to-pink-600",
    "from-emerald-400 to-teal-600",
    "from-amber-300 to-orange-500",
  ];
  return (
    <div className="grid w-[176px] grid-cols-3 gap-[2px] overflow-hidden rounded-md md:w-[210px]">
      {tiles.map((t, i) => (
        <div key={i} className={`aspect-square bg-gradient-to-br ${t}`} />
      ))}
    </div>
  );
}
