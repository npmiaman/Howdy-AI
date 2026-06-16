# Decisions

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
  Reason: don't leak client identity to people who pass (privacy, §5.9).
- **Dry-run first.** Built behind `HOWDY_OUTREACH_DRYRUN` (default ON). In
  dry-run, intended emails are logged + recorded, never sent. Flip to live only
  after the saga logic is proven end-to-end (§14.5 shadow-before-live).

**Trajectory-predictive matching.** Not yet built (FDR research stage). The
ranking step uses the existing embedding + LLM-rerank shortlist for now, behind
a `rankMatches()` seam so the trajectory model can drop in later without
touching the saga.

**Reversibility.** The whole saga is gated by `HOWDY_OUTREACH_DRYRUN`. To stop
all outbound at once, set it back to `true`. Candidate state lives in
`match_candidates`; a request can be reset by deleting its rows.
