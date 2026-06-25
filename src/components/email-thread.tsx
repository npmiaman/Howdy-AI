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
  kind: "pdf" | "image" | "audio" | "figma" | "gdrive" | "gdoc";
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

  if (tab === "whatsapp") {
    return (
      <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl bg-white font-[system-ui,sans-serif] text-[#202124] shadow-2xl ring-1 ring-black/10">
        <BrowserChrome active="whatsapp" onSelect={setTab} />
        {/* Same conversation as the Gmail tab, rendered as a chat. */}
        <WhatsAppPanel messages={visible} />
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
        <div className="mt-0.5 text-[11px] text-neutral-500">
          {cloudLabel(file.kind) ?? file.size}
        </div>
      </div>
    </div>
  );
}

function FileIcon({ kind }: { kind: Attachment["kind"] }) {
  if (cloudLabel(kind)) return <CloudIcon kind={kind} />;
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
  gdrive: { bg: "bg-[#1FA463]", label: "DRIVE" },
  gdoc: { bg: "bg-[#4285F4]", label: "DOC" },
};

// Cloud-file kinds render their own brand logo + a "Google …" label.
function cloudLabel(kind: Attachment["kind"]): string | null {
  if (kind === "gdrive") return "Google Drive";
  if (kind === "gdoc") return "Google Docs";
  return null;
}

// The Google Drive tri-color triangle logo.
function DriveIcon({ className = "h-7 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={`shrink-0 ${className}`} aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.151 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

// The Google Docs blue document logo.
function DocsIcon({ className = "h-8 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 47 64" className={`shrink-0 ${className}`} aria-hidden>
      <path
        d="M29.5 0H6C2.7 0 0 2.7 0 6v52c0 3.3 2.7 6 6 6h35c3.3 0 6-2.7 6-6V17.5z"
        fill="#4285F4"
      />
      <path d="M29.5 0v12c0 3 2.5 5.5 5.5 5.5H47z" fill="#A1C2FA" />
      <g fill="#fff">
        <rect x="11" y="29" width="25" height="3" rx="1.5" />
        <rect x="11" y="37" width="25" height="3" rx="1.5" />
        <rect x="11" y="45" width="16" height="3" rx="1.5" />
      </g>
    </svg>
  );
}

function CloudIcon({ kind }: { kind: Attachment["kind"] }) {
  if (kind === "gdrive") return <DriveIcon className="h-7 w-8" />;
  return <DocsIcon className="h-8 w-6" />;
}

/* ---------------------------------------------------------------------------
 * WhatsApp tab — the SAME conversation as the Gmail thread, rendered as a chat.
 * ------------------------------------------------------------------------- */

type WaItem = {
  direction: "incoming" | "outgoing";
  time: string;
  text?: React.ReactNode;
  attachment?: Attachment;
};

// Flatten the email thread into chat items: a text bubble per message plus one
// bubble per attachment — so both tabs show the exact same conversation.
function toWaItems(messages: EmailMessage[]): WaItem[] {
  const items: WaItem[] = [];
  for (const m of messages) {
    if (m.snippet) {
      items.push({ direction: m.direction, time: m.time, text: m.snippet });
    }
    for (const a of m.attachments ?? []) {
      items.push({ direction: m.direction, time: m.time, attachment: a });
    }
  }
  return items;
}

function WhatsAppPanel({ messages }: { messages: EmailMessage[] }) {
  const items = toWaItems(messages);
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
      <div className="space-y-1 bg-[#efeae2] px-4 pb-4 pt-3 md:space-y-1.5 md:px-9 md:pb-5 md:pt-4">
        <div className="flex justify-center pb-2">
          <span className="rounded-lg bg-white px-2.5 py-1 text-[9px] font-medium uppercase tracking-wide text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] md:text-[10px]">
            Today
          </span>
        </div>
        {items.map((it, i) => (
          <WaBubble
            key={i}
            item={it}
            isLatest={i === items.length - 1}
            showTail={i === 0 || items[i - 1].direction !== it.direction}
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
  item,
  isLatest,
  showTail,
}: {
  item: WaItem;
  isLatest: boolean;
  showTail: boolean;
}) {
  const isOut = item.direction === "outgoing";
  const att = item.attachment;
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

        {att &&
          (att.kind === "image" ? (
            <WaImage name={att.name} />
          ) : (
            <WaDocCard file={att} />
          ))}

        {item.text && <div className="px-1.5 pt-1">{item.text}</div>}

        <div className="flex items-center justify-end gap-1 px-1.5 pb-0.5 pt-0.5 text-[8px] leading-none text-[#667781] md:text-[10px]">
          {item.time}
          {isOut && (
            <CheckCheck className="size-3 text-[#53bdeb] md:size-3.5" strokeWidth={2} />
          )}
        </div>
      </div>
    </div>
  );
}

// WhatsApp document share — a tappable file row inside the bubble.
function WaDocCard({ file }: { file: Attachment }) {
  const meta = attachmentStyles[file.kind];
  const cloud = cloudLabel(file.kind);
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-black/[0.06] px-2.5 py-2">
      {cloud ? (
        <CloudIcon kind={file.kind} />
      ) : (
        <div className="relative shrink-0">
          <div
            className={`flex h-9 w-7 flex-col items-center justify-end rounded-[3px] pb-0.5 ${meta.bg}`}
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
      )}
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-[#111b21] md:text-[12.5px]">
          {file.name}
        </div>
        <div className="mt-0.5 text-[9px] text-[#667781] md:text-[10px]">
          {cloud ?? `${file.size} · ${meta.label}`}
        </div>
      </div>
    </div>
  );
}

// WhatsApp image share — a small collage standing in for a shared photo.
function WaImage({ name }: { name: string }) {
  const tiles = [
    "from-indigo-500 to-purple-600",
    "from-zinc-700 to-zinc-950",
    "from-sky-400 to-blue-600",
    "from-rose-400 to-pink-600",
    "from-emerald-400 to-teal-600",
    "from-amber-300 to-orange-500",
  ];
  return (
    <div>
      <div className="grid w-[176px] grid-cols-3 gap-[2px] overflow-hidden rounded-md md:w-[210px]">
        {tiles.map((t, i) => (
          <div key={i} className={`aspect-square bg-gradient-to-br ${t}`} />
        ))}
      </div>
      <div className="mt-1 truncate px-1.5 text-[9px] text-[#667781] md:text-[10px]">
        {name}
      </div>
    </div>
  );
}
