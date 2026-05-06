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
      <div className="flex items-center justify-between border-b border-neutral-200 px-2 py-1 lg:px-3 lg:py-1.5">
        <div className="flex items-center gap-0.5 text-neutral-600">
          <ToolbarButton>
            <ArrowLeft className="size-4 lg:size-5" />
          </ToolbarButton>
          <span className="mx-1.5 h-4 w-px bg-neutral-200 lg:mx-2 lg:h-5" />
          <ToolbarButton>
            <Archive className="size-4 lg:size-5" />
          </ToolbarButton>
          <ToolbarButton>
            <Trash2 className="size-4 lg:size-5" />
          </ToolbarButton>
          <ToolbarButton>
            <Mail className="size-4 lg:size-5" />
          </ToolbarButton>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-neutral-500 lg:text-xs">
            1 of 423
          </span>
          <ToolbarButton>
            <MoreVertical className="size-4 lg:size-5" />
          </ToolbarButton>
        </div>
      </div>

      {/* Subject */}
      <div className="flex items-start justify-between gap-2 px-3 pb-2 pt-3 lg:gap-3 lg:px-5 lg:pb-3 lg:pt-4">
        <div className="flex flex-wrap items-start gap-1.5 lg:gap-2">
          <h2 className="text-[14px] font-normal leading-tight lg:text-[18px]">
            {subject}
          </h2>
          <span className="mt-0.5 inline-flex items-center rounded border border-neutral-300 px-1 py-0.5 text-[9px] text-neutral-700 lg:mt-1 lg:px-1.5 lg:text-[10px]">
            Inbox
          </span>
        </div>
        <Star className="mt-1 size-3.5 shrink-0 text-neutral-400 lg:mt-1.5 lg:size-4" />
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
    <div className="flex items-end gap-2 bg-[#e8e8e8] px-2 pt-2 lg:gap-3 lg:px-3 lg:pt-3">
      <div className="flex items-center gap-1 pb-1.5 lg:gap-1.5 lg:pb-2.5">
        <span className="size-2.5 rounded-full bg-[#FF5F57] lg:size-3" />
        <span className="size-2.5 rounded-full bg-[#FEBC2E] lg:size-3" />
        <span className="size-2.5 rounded-full bg-[#28C840] lg:size-3" />
      </div>
      <div className="flex h-7 items-center gap-1.5 rounded-t-md bg-white pl-2 pr-1.5 text-[11px] font-medium text-neutral-700 lg:h-9 lg:gap-2 lg:pl-3 lg:pr-2 lg:text-[13px]">
        <Image
          src="/gmail-icon.png"
          alt="Gmail"
          width={20}
          height={20}
          className="size-4 shrink-0 lg:size-5"
        />
        <span>Gmail</span>
        <span className="ml-0.5 flex size-3.5 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 lg:ml-1 lg:size-4">
          <X className="size-2.5 lg:size-3" strokeWidth={2.25} />
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
      className="flex w-full items-center gap-2 border-t border-neutral-200 px-3 py-2 text-left transition-colors hover:bg-neutral-50 lg:gap-3 lg:px-5 lg:py-3"
    >
      <div
        className={`flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white shadow-sm lg:size-8 lg:text-[12px] ${message.color}`}
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
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 lg:gap-2">
        <span className="shrink-0 text-[11px] font-semibold text-neutral-900 lg:text-[13px]">
          {message.from}
        </span>
        <span className="truncate text-[10px] text-neutral-500 lg:text-[12px]">
          {message.snippet}
        </span>
      </div>
      <span className="shrink-0 text-[9px] text-neutral-500 lg:text-[11px]">
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
      className={`border-t border-neutral-200 px-3 pb-4 pt-3 animate-in fade-in ${slideClass} duration-500 lg:px-5 lg:pb-5 lg:pt-4`}
    >
      <div className="flex items-start gap-2 lg:gap-3">
        <div
          className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold text-white shadow-sm lg:size-10 lg:text-[13px] ${message.color}`}
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
            <div className="text-[11px] leading-snug lg:text-[13px]">
              <span className="font-semibold text-neutral-900">
                {message.from}
              </span>{" "}
              <span className="text-neutral-500">&lt;{message.email}&gt;</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 lg:gap-2 lg:text-[11px]">
              <span className="hidden sm:inline">{message.time}</span>
              <Star className="size-3 text-neutral-400 lg:size-3.5" />
              <Reply className="size-3 lg:size-3.5" />
              <MoreVertical className="size-3 lg:size-3.5" />
            </div>
          </div>

          <div className="mt-2 space-y-2 text-[12px] leading-relaxed lg:mt-3 lg:space-y-2.5 lg:text-[13px]">
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
