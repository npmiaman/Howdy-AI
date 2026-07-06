/**
 * Email body generation for the outreach saga. Pure content — no sending.
 *   - freelancerPitch: ANONYMIZED check-in to a candidate (no client identity).
 *   - clientShortlistNote: the per-freelancer "why they fit" note for the client.
 *   - freelancerAcceptResponse / connectNotice / connectIntro: short transactional copy.
 * See DECISIONS.md (2026-06-16): anonymized until accept.
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

import { getChatModel } from "./llm";
import type { Brief, Freelancer } from "./types";

async function write(system: string, user: string): Promise<string> {
  const reply = await getChatModel().invoke([
    new SystemMessage(system),
    new HumanMessage(user),
  ]);
  return (
    typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content)
  ).trim();
}

/** What a freelancer is allowed to see before they accept — NO client identity. */
function anonymizedBrief(brief: Brief): string {
  const lines: string[] = [];
  if (brief.role) lines.push(`Role: ${brief.role}`);
  if (brief.description)
    lines.push(`Project (paraphrase, no client name): ${brief.description}`);
  if (brief.domain) lines.push(`Industry: ${brief.domain}`);
  if (brief.deadline) lines.push(`Timeline: ${brief.deadline}`);
  if (brief.budget_usd_per_hour_max)
    lines.push(`Budget: up to $${brief.budget_usd_per_hour_max}/hr`);
  if (brief.references?.length)
    lines.push(`Style/vibe: ${brief.references.join(", ")}`);
  if (brief.stack_or_tools?.length)
    lines.push(`Tools: ${brief.stack_or_tools.join(", ")}`);
  if (brief.collaboration_style)
    lines.push(`Working style: ${brief.collaboration_style}`);
  return lines.join("\n");
}

const PITCH_SYSTEM = `You are Howdy, reaching out to a vetted freelancer to check if they're open to a gig. Write a SHORT, warm email (3-4 sentences max).

Hard rules:
- This freelancer has NOT been chosen yet — you're checking availability and interest. Be clear it's a check-in, not a confirmed booking.
- NEVER reveal the client's name, company, or any identifying detail. Only the anonymized brief provided.
- Give them just enough to decide: the kind of work, industry, timeline, budget, vibe.
- Ask one clear question: are they open and available for something like this?
- Tell them to just reply yes or no (a yes means you'll share full details and connect them).
- Sound like a sharp human matchmaker texting, not a mass email. No subject line, no signature block.`;

export async function freelancerPitch(args: {
  freelancer: Freelancer;
  brief: Brief;
}): Promise<string> {
  return write(
    PITCH_SYSTEM,
    `Freelancer's first name: ${args.freelancer.name.split(" ")[0]}
Their role: ${args.freelancer.role}

Anonymized brief (this is ALL they may see):
${anonymizedBrief(args.brief)}

Write the check-in email.`,
  );
}

const CLIENT_NOTE_SYSTEM = `You are Howdy, introducing ONE shortlisted freelancer to the client who'll review them. Write 2-3 sentences on why this person fits.

Rules:
- Speak to fit with THIS project AND this client's stated needs (taste, budget, timeline, working style).
- Reference concrete signals: portfolio, specialties, rate, timezone, relevant past work.
- Confident but honest — no hype. This is one of three options the client will choose from.
- No greeting, no signature. Just the note about this freelancer.`;

export async function clientShortlistNote(args: {
  freelancer: Freelancer;
  brief: Brief;
  rationale: string | null;
}): Promise<string> {
  return write(
    CLIENT_NOTE_SYSTEM,
    `Client brief:
${JSON.stringify(args.brief, null, 2)}

Freelancer:
Name: ${args.freelancer.name}
Role: ${args.freelancer.role}
Skills: ${args.freelancer.skills.join(", ")}
Specialties: ${args.freelancer.specialties.join(", ")}
Rate: $${args.freelancer.rate_usd_per_hour}/hr
Timezone: ${args.freelancer.timezone}
Bio: ${args.freelancer.bio}
Portfolio: ${args.freelancer.portfolio_summary}
${args.rationale ? `Ranker's reasoning: ${args.rationale}` : ""}

Write the fit note for the client.`,
  );
}

/** Assemble the full email Howdy sends the client with the shortlist. */
export async function clientShortlistEmail(args: {
  brief: Brief;
  picks: Array<{ freelancer: Freelancer; rationale: string | null }>;
  fewerThanTarget: boolean;
  // provisional = these are the best DB matches but we have NOT yet confirmed
  // their availability (the 24h fallback path). Copy must not claim otherwise.
  provisional?: boolean;
}): Promise<string> {
  const notes = await Promise.all(
    args.picks.map(async (p, i) => {
      const note = await clientShortlistNote({
        freelancer: p.freelancer,
        brief: args.brief,
        rationale: p.rationale,
      });
      return `${i + 1}. ${p.freelancer.name} — ${p.freelancer.role}, $${p.freelancer.rate_usd_per_hour}/hr (${p.freelancer.timezone})\n${note}`;
    }),
  );

  const count = args.picks.length;
  let intro: string;
  if (args.provisional) {
    // Honest: strong matches, availability not yet confirmed.
    intro = `Here ${count === 1 ? "is" : "are"} the ${count === 1 ? "strongest match" : `top ${count} matches`} from our network for your brief. I'm confirming their availability now, but wanted to get ${count === 1 ? "them" : "these"} in front of you rather than keep you waiting:`;
  } else if (args.fewerThanTarget) {
    intro = `Good news — I've lined up ${count} creative${count === 1 ? "" : "s"} who ${count === 1 ? "is" : "are"} confirmed available and keen. I'm still scouting for more, but didn't want to hold these up:`;
  } else {
    intro = `Good news — I've lined up 3 creatives who are confirmed available and genuinely keen on your project:`;
  }

  const outro = `Reply with the name(s) you'd like to connect with — one or more is totally fine — and I'll make the intro.`;

  return `${intro}\n\n${notes.join("\n\n")}\n\n${outro}`;
}

const ACCEPT_REPLY_SYSTEM = `You are Howdy, replying to a freelancer who just said YES to a gig check-in. Write ONE short, warm line confirming you've noted their interest and you'll be in touch shortly if it's a fit. Do NOT yet reveal the client identity or promise the booking. No greeting/signature.`;

export async function freelancerAcceptAck(
  freelancer: Freelancer,
): Promise<string> {
  return write(
    ACCEPT_REPLY_SYSTEM,
    `Freelancer first name: ${freelancer.name.split(" ")[0]}. Write the quick acknowledgment.`,
  );
}

const CONNECT_NOTICE_SYSTEM = `You are Howdy, telling a freelancer the client picked them and you're about to connect them directly. Write ONE short, upbeat line. This is a heads-up, not a question — they already agreed to be considered. You'll send the intro email shortly. No greeting/signature.`;

export async function connectNotice(args: {
  freelancer: Freelancer;
  brief: Brief;
}): Promise<string> {
  return write(
    CONNECT_NOTICE_SYSTEM,
    `Freelancer first name: ${args.freelancer.name.split(" ")[0]}. Role: ${args.brief.role}. Write the heads-up.`,
  );
}

const CONNECT_INTRO_SYSTEM = `You are Howdy, writing the intro email that connects a client and a freelancer directly (both are CC'd). Warm, brief (2-3 sentences): introduce them by first name, say in one line why they're a great fit, and hand it over for them to take from here. No signature block beyond "— Howdy".`;

export async function connectIntro(args: {
  freelancer: Freelancer;
  clientName: string | null;
  brief: Brief;
  rationale: string | null;
}): Promise<string> {
  return write(
    CONNECT_INTRO_SYSTEM,
    `Client name (use first name if it looks like a person, else "there"): ${args.clientName ?? "there"}
Freelancer name: ${args.freelancer.name}
Role needed: ${args.brief.role}
Why they fit: ${args.rationale ?? args.freelancer.portfolio_summary}

Write the intro email.`,
  );
}
