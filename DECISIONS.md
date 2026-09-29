# Decisions

## 2026-09-29 (evening) — Agent abilities round (docs/agent-abilities.md)

- **Voice: prevention plus a check, not a blanket rewrite.** The voice guide
  (from blader/humanizer, MIT) goes on every writing prompt. Each AI-written
  message is scored by brandonwise/humanizer (MIT, pinned commit, zero deps).
  Only messages that still read as AI get one rewrite, and it's kept only if
  it scores better and keeps every number and link. Clean text costs nothing
  extra. Chosen over always rewriting (doubles latency on the free tier) and
  over a detector-only approach (flags without fixing).
- **Hand-over rides on existing classifiers** (assessor, client-reply
  router), so it adds no extra AI calls. Payment, refund, pricing and legal
  questions go to a person, because pricing on the site is still
  contradictory.
- **Freelancer answers use only the anonymised brief**; the client's
  identity is never revealed before they accept.
- **Anonymisation is checked after writing.** A leaked name means the fixed
  pitch goes out instead, trading warmth for privacy on the rare leak.

## 2026-09-29 (later) — Take-over, limits, opt-outs, billing, digest

- **Human takeover is detected, not declared.** Howdy labels its own sends
  `howdy-auto`; an unlabelled outbound message on a thread means a person
  replied, and the conversation pauses. Chosen over a toggle in Momo (not in
  this repo) or email commands (easy to forget). Existing conversations
  start paused (migration 0007) because the team handles all of them today.
- **Rate limits live in Postgres** (no new vendor), fail open, env-tunable.
  The daily AI budget exists because the Gemini key is on the free tier.
- **Opt-out is strict:** only a reply whose first line is STOP/unsubscribe
  counts; any real message later opts back in.
- **Billing phase 1 only records and discloses** ($50/intro as on the
  site). Charging waits on the owner's pricing decisions.
- **Model pinned to gemini-3.5-flash-lite** after a live check: 11/12
  intents, ~1s median, vs 62s for gemini-flash-latest.
- **Ranking quality is limited by roster data**, not just the ranker: on the
  first answer-key run neither on-roster human pick made the top 3; Joy's
  profile is role "Other" with a 42-char bio, and every rate is 0.

## 2026-09-29 — Make the flow work end to end (owner asked: "the entire workflow should work end to end")

**Evidence that drove this.** Production data: since the saga shipped, no
request ever reached matching (the only two `pending_matches` rows were from
May). Real clients were answered by hand. The AgentMail webhook was disabled on
2026-07-15, the day after Howdy auto-replied twice, asking for a budget, on an
agency thread it was only CC'd on — whose inbound bodies had parsed as empty.

**Decisions:**
- **Brief gate = four required fields** (description, role, deadline, budget),
  down from all twelve; clarifying-turn cap 12 → 6. The other fields still
  sharpen ranking when offered. Reverses the 2026-06-16 "deep brief" bar,
  which in practice matched nobody. To reverse: `REQUIRED_FIELDS` in types.ts.
- **Never auto-reply** to: bounces/auto-replies, the team's own mail
  (Bridge Creatives domains), threads where Howdy is only CC'd, or emails with
  no readable text. Ops gets an alert instead.
- **Client replies route by the request's real phase.** While recruiting,
  replies get a status update — never "you already have a match".
- **Rematch = a new request** on the same thread, recruiting only people not
  yet contacted. A new request restarts the 24h guarantee; reopening the old
  one would have fired (or skipped) the fallback based on the old timestamp.
- **Clients can pick unconfirmed (provisional) freelancers.** They become
  `chosen`, get a "the client picked you — still up for it?" nudge, and the
  intro waits for their yes. The 24h fallback now invites provisional picks it
  hadn't contacted (its copy says "I'm confirming their availability") and
  never shows anyone who declined.
- **A freelancer's bad call goes to the team,** not a client rematch.
- **Dry-run covers every saga-status email** (status replies, selection acks,
  nudges), not just invites; `HOWDY_DRYRUN_ALLOWLIST` lets the team test for
  real. Intake replies still always send.
- **Idempotency by claims:** every email-sending step claims its state change
  with a conditional update first; duplicate webhook deliveries are skipped.
  Claims expire after 10 minutes so a run killed mid-step (Vercel's 60s limit)
  can't strand a request.
- **Fail fast on the model:** at most one retry per Gemini call and a 50s
  webhook deadline that alerts ops. Open for the owner: which model to pin —
  `gemini-flash-latest` → `gemini-3.8-flash` measured 17–55s per call, with
  503s and a 429 quota error, on 2026-09-29.
- **Webhook auth fails closed in production** (Svix signature required).
- **Silent sign-ups:** one nudge at 48h, only for sign-ups under 14 days old
  (so enabling it never mails old leads).
- **Freelancer applications** via a form (`/api/freelancer-apply`), reviewed
  by a human (`npm run applications`), replacing the mailto that dropped
  freelancers into the client flow.

## 2026-06-16 — Freelancer outreach saga (multi-actor matching flow)

**Context.** After a brief is complete, Howdy must rank candidates, quietly
recruit a shortlist of 3 willing freelancers over email (invisible to the
client), present them, then broker the connection. This is an asynchronous
multi-actor saga driven by inbound email over hours/days.

**Flow (8 phases of a match request):**
1. `matching` — brief complete; ack sent ("back in a few hours").
2. `outreach` — rank candidates; invite top 3; on each decline/timeout invite
   the next-ranked; accumulate until 3 accept.
3. `shortlist_sent` — email the client the 3 acceptors with per-freelancer
   fit notes.
4. `client_selected` — client picks 1+.
5. `connecting` — notify each chosen freelancer ("connecting you", no re-ask).
6. `connected` — minutes later, one email CC'ing client + freelancer.
7/8. terminal: `done` / `failed`.

**Decisions (owner: Aman, 2026-06-16):**
- **No-reply timeout = 24h.** An `invited` candidate with no reply after 24h is
  marked `timed_out` and the next-ranked is invited. Reason: keeps the "few
  hours" promise closer to true.
- **Too few accepts → send what we have + flag.** If the ranked roster is
  exhausted before 3 accept, email the client the 1–2 acceptors and note we're
  still scouting. Reason: momentum + honesty over stalling.
- **Anonymized until accept.** The outreach email to freelancers (who may
  decline) reveals project type, budget, timeline, vibe — NOT the client's
  identity. Client identity is revealed only after the freelancer accepts.
  Reason: don't leak client identity to people who pass (privacy).
- **Dry-run first.** Built behind `HOWDY_OUTREACH_DRYRUN` (default ON). In
  dry-run, intended emails are logged + recorded, never sent. Flip to live only
  after the saga logic is proven end-to-end (shadow before live).

**Trajectory-predictive matching.** Not yet built (FDR research stage). The
ranking step uses the existing embedding + LLM-rerank shortlist for now, behind
a `rankMatches()` seam so the trajectory model can drop in later without
touching the saga.

**Reversibility.** The whole saga is gated by `HOWDY_OUTREACH_DRYRUN`. To stop
all outbound at once, set it back to `true`. Candidate state lives in
`match_candidates`; a request can be reset by deleting its rows.
