/**
 * Email body generation for the outreach saga. Pure content — no sending.
 *   - freelancerPitch: ANONYMIZED check-in to a candidate (no client identity).
 *   - clientShortlistNote: the per-freelancer "why they fit" note for the client.
 *   - connectIntro: the intro email; the one-line acks are fixed templates below.
 * See DECISIONS.md (2026-06-16): anonymized until accept.
 */
import { firstName } from "@/lib/utils";

import { pricingNote } from "./billing";
import { rateLabel } from "./data";
import { generateText as write } from "./generate";
import { type Brief, type Freelancer, PROMISE_HOURS } from "./types";


/** What a freelancer is allowed to see before they accept — NO client identity. */
export function anonymizedBrief(brief: Brief): string {
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
    `Freelancer's first name: ${firstName(args.freelancer.name)}
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
Rate: ${rateLabel(args.freelancer.rate_usd_per_hour)}
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
      return `${i + 1}. ${p.freelancer.name}, ${p.freelancer.role} (${rateLabel(p.freelancer.rate_usd_per_hour)}, ${p.freelancer.timezone})\n${note}`;
    }),
  );

  const count = args.picks.length;
  let intro: string;
  if (args.provisional) {
    // Honest: strong matches, availability not yet confirmed.
    intro = `Here ${count === 1 ? "is" : "are"} the ${count === 1 ? "strongest match" : `top ${count} matches`} from our network for your brief. I'm confirming their availability now, but wanted to get ${count === 1 ? "them" : "these"} in front of you rather than keep you waiting:`;
  } else if (args.fewerThanTarget) {
    intro = `Good news: I've lined up ${count} creative${count === 1 ? "" : "s"} who ${count === 1 ? "is" : "are"} confirmed available and keen. I'm still scouting for more, but didn't want to hold these up:`;
  } else {
    intro = `Good news: I've lined up 3 creatives who are confirmed available and genuinely keen on your project:`;
  }

  const outro = `Reply with the name(s) you'd like to meet (one or more is fine) and I'll make the intro.\n\n${pricingNote()}`;

  return `${intro}\n\n${notes.join("\n\n")}\n\n${outro}`;
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

const FREELANCER_QA_SYSTEM = `You are Howdy, answering a freelancer's question about a gig you just offered them. Use ONLY the anonymised brief below. Never reveal or guess the client's name, company or identity. If the brief doesn't answer the question, say so plainly and that you'll share the full details once they're in. One to three short sentences. Don't ask whether they're available; that line is added after your answer.`;

/** Answer a freelancer's question from the anonymised brief, then ask for their yes/no. */
export async function answerFreelancerQuestion(args: {
  brief: Brief;
  question: string;
}): Promise<string> {
  const answer = await write(
    FREELANCER_QA_SYSTEM,
    `Anonymised brief:\n${anonymizedBrief(args.brief)}\n\nTheir question:\n${args.question}`,
  );
  return `${answer}\n\nAre you open to it? A quick yes or no works.`;
}

// ------------------------------------------------ transactional templates
// Fixed copy (no LLM) for messages whose wording carries a promise — each one
// describes exactly what the code does next.

/** A freelancer said yes to an invite (still anonymized — no booking promised). */
export function freelancerAcceptAck(freelancer: Freelancer): string {
  return `Thanks ${firstName(freelancer.name)}, noted. If the client picks you, I'll connect you directly.`;
}

/** Heads-up to a confirmed freelancer that the client picked them. */
export function connectNotice(freelancer: Freelancer): string {
  return `Good news, ${firstName(freelancer.name)}: the client picked you. I'm sending an intro email to you both shortly.`;
}

/** Client picked a freelancer who hasn't confirmed yet: ask for their yes. */
export function chosenNudge(freelancer: Freelancer): string {
  const first = firstName(freelancer.name);
  return `Hey ${first}, good news: the client would love to work with you on this one. Still up for it? A quick yes and I'll make the intro.`;
}

/** A chosen freelancer turned it down after the client picked them. */
export function chosenUnavailableNotice(freelancer: Freelancer): string {
  const first = firstName(freelancer.name);
  return `Quick update: ${first} can't take this one on after all. Reply with another name from the shortlist, or say "anyone else" and I'll line up fresh people.`;
}

/** The client's acknowledgement after they pick from the shortlist. */
export function selectionAck(args: {
  confirmed: string[];
  pending: string[];
}): string {
  const names = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const parts: string[] = [];
  if (args.confirmed.length)
    parts.push(
      `Perfect, connecting you with ${names(args.confirmed)} now. The intro will land in your inbox shortly.`,
    );
  if (args.pending.length)
    parts.push(
      `I'm checking ${names(args.pending)}'s availability now and will intro you as soon as they confirm.`,
    );
  return parts.join(" ");
}

/**
 * A pitch in fixed words, used when the written one might reveal the client.
 * Deliberately leaves out the project description (it can carry a name).
 */
export function templatePitch(freelancer: Freelancer, brief: Brief): string {
  const facts = [
    brief.domain ? `It's in ${brief.domain}` : "",
    brief.deadline ? `the timeline is ${brief.deadline}` : "",
    brief.budget_usd_per_hour_max ? `budget is up to $${brief.budget_usd_per_hour_max}/hr` : "",
  ].filter(Boolean);
  return [
    `Hi ${firstName(freelancer.name)}, quick one: are you open to a ${brief.role ?? "creative"} gig?`,
    facts.length ? `${facts.join(", ")}.` : "",
    brief.references?.length ? `The style they like: ${brief.references.join(", ")}.` : "",
    "Reply yes or no. A yes means I'll share the full details and connect you.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** One honest update while recruiting runs long. */
export function progressNote(confirmed: number, hours: number): string {
  const wait = `Your shortlist will reach you within ${hours} hour${hours === 1 ? "" : "s"}.`;
  return confirmed > 0
    ? `Quick update: ${confirmed} of the creatives I reached out to ${confirmed === 1 ? "has" : "have"} confirmed so far, and I'm waiting on one or two more. ${wait}`
    : `Quick update: I'm still lining people up for you. ${wait}`;
}

/** Holding reply when a conversation is handed to a person on the team. */
export function humanHandoverNotice(): string {
  return "That one's for my teammate, so I've looped them in. They'll reply here soon.";
}

/** A rematch search has been queued. */
export function rematchStartedNotice(): string {
  return `On it. I'll line up fresh people (nobody you've already seen) and send them over within ${PROMISE_HOURS} hours.`;
}

/** No one in the network fits (or everyone who does has been tried). */
export function noMatchNotice(role: string | null): string {
  return `I've been through everyone in my network who fits this ${role ?? "brief"} and don't have a strong match right now. If you can loosen one thing — budget, timeline, or style — reply with it and I'll search again.`;
}
