import Image from "next/image";
import {
  Archive,
  ArrowLeft,
  Forward,
  Mail,
  MoreVertical,
  Reply,
  Star,
  Trash2,
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
  const safeStep = Math.max(0, Math.min(messages.length - 1, currentStep));
  const visible = messages.slice(0, safeStep + 1);
  const collapsed = visible.slice(0, -1);
  const expanded = visible[visible.length - 1];
  const isLastStep = safeStep === messages.length - 1;

  return (
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl bg-white font-[system-ui,sans-serif] text-[#202124] shadow-2xl ring-1 ring-black/10">
      {/* macOS browser chrome */}
      <BrowserChrome />

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5">
        <div className="flex items-center gap-0.5 text-neutral-600">
          <ToolbarButton>
            <ArrowLeft className="size-5" />
          </ToolbarButton>
          <span className="mx-2 h-5 w-px bg-neutral-200" />
          <ToolbarButton>
            <Archive className="size-5" />
          </ToolbarButton>
          <ToolbarButton>
            <Trash2 className="size-5" />
          </ToolbarButton>
          <ToolbarButton>
            <Mail className="size-5" />
          </ToolbarButton>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-neutral-500">1 of 423</span>
          <ToolbarButton>
            <MoreVertical className="size-5" />
          </ToolbarButton>
        </div>
      </div>

      {/* Subject */}
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-start gap-2">
          <h2 className="text-[18px] font-normal leading-tight">{subject}</h2>
          <span className="mt-1 inline-flex items-center rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-700">
            Inbox
          </span>
        </div>
        <Star className="mt-1.5 size-4 shrink-0 text-neutral-400" />
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

export function BrowserChrome() {
  return (
    <div className="flex items-end gap-3 bg-[#e8e8e8] px-3 pt-3">
      <div className="flex items-center gap-1.5 pb-2.5">
        <span className="size-3 rounded-full bg-[#FF5F57]" />
        <span className="size-3 rounded-full bg-[#FEBC2E]" />
        <span className="size-3 rounded-full bg-[#28C840]" />
      </div>
      <div className="flex h-9 items-center gap-2 rounded-t-md bg-white pl-3 pr-2 text-[13px] font-medium text-neutral-700">
        <Image
          src="/gmail-icon.png"
          alt="Gmail"
          width={20}
          height={20}
          className="shrink-0"
        />
        <span>Gmail</span>
        <span className="ml-1 flex size-4 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700">
          <X className="size-3" strokeWidth={2.25} />
        </span>
      </div>
    </div>
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
      className="flex w-full items-center gap-3 border-t border-neutral-200 px-5 py-3 text-left transition-colors hover:bg-neutral-50"
    >
      <div
        className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[12px] font-semibold text-white shadow-sm ${message.color}`}
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
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 text-[13px] font-semibold text-neutral-900">
          {message.from}
        </span>
        <span className="truncate text-[12px] text-neutral-500">
          {message.snippet}
        </span>
      </div>
      <span className="shrink-0 text-[11px] text-neutral-500">
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
      className={`border-t border-neutral-200 px-5 pt-4 pb-5 animate-in fade-in ${slideClass} duration-500`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-[13px] font-semibold text-white shadow-sm ${message.color}`}
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
            <div className="text-[13px] leading-snug">
              <span className="font-semibold text-neutral-900">
                {message.from}
              </span>{" "}
              <span className="text-neutral-500">&lt;{message.email}&gt;</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
              <span className="hidden sm:inline">{message.time}</span>
              <Star className="size-3.5 text-neutral-400" />
              <Reply className="size-3.5" />
              <MoreVertical className="size-3.5" />
            </div>
          </div>

          <div className="mt-3 space-y-2.5 text-[13px] leading-relaxed">
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
