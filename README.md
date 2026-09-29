# Howdy

An AI talent scout that lives in your inbox. A client describes the creative they need — by email or in the website chat — and Howdy asks a few sharp questions, quietly recruits freelancers who are actually available, and emails a shortlist of three within 24 hours. Then it makes the intro and checks in on how it went.

This repo holds both halves: the marketing site and the agent backend, deployed as one Next.js app on Vercel.

Live: https://www.bridgecreatives.co

---

## What's in here

```
src/
├── app/
│   ├── page.tsx, freelancers/, faq/          ← marketing site
│   └── api/
│       ├── lead/route.ts                     ← hire form → lead + welcome email
│       ├── howdy/chat/                       ← website chat intake → email handoff
│       ├── freelancer-apply/route.ts         ← freelancer roster applications
│       ├── agentmail/webhook/route.ts        ← every inbound email
│       └── howdy/process-pending/route.ts    ← cron worker that advances the saga
├── components/                               ← UI, dialogs (Hire, Contact, Apply), chat widget
└── lib/
    ├── howdy/                                ← agent, matcher, saga, routing, guardrails
    ├── agentmail/                            ← AgentMail wrapper (send / reply / parse)
    └── supabase/                             ← Supabase admin client
supabase/migrations/                          ← schema, 0001 → 0006 (apply in order)
tests/                                        ← Vitest: unit + end-to-end, all services faked
scripts/                                      ← CLI helpers (seed, applications, backups)
.github/workflows/howdy-cron.yml              ← scheduler for the cron worker
```

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) on Vercel |
| Styling | Tailwind v4, shadcn/ui (Radix) |
| Agent | LangGraph.js + LangChain core |
| LLM | Gemini `gemini-flash-latest` |
| Embeddings | Gemini `gemini-embedding-001` (768 dims) |
| Database | Supabase Postgres + pgvector |
| Email | [AgentMail](https://agentmail.to) — webhook in (Svix-signed), API out |
| Tests | Vitest |

## How it works

**1. Intake.** A client signs up (welcome email from `howdyai@agentmail.to`) and replies, or chats on the site and hands over their email. Each turn, Howdy extracts a structured brief and audits it. It starts recruiting once the four required fields — description, role, deadline, budget — are clear (`REQUIRED_FIELDS` in `types.ts`), and stops asking after six clarifying turns regardless.

**2. Recruiting (the saga).** The request is deferred up to 3 hours so replies feel human, then the cron worker ranks the roster (vector search + LLM rerank), invites the top 3 with an anonymized pitch, and replaces anyone who declines or doesn't answer within 6 hours. Three yeses → the client gets the shortlist.

**3. The 24-hour guarantee.** If three haven't said yes by hour 20, the client gets the best we have: confirmed freelancers first, otherwise top-ranked ones flagged as "confirming availability" — and those really are invited to confirm. Nobody who declined is ever shown.

**4. Client replies** are routed by where their request actually is (`client-replies.ts`):

| Where the request is | Client says | What happens |
|---|---|---|
| still recruiting | anything | honest status update; new details are added to the brief |
| shortlist sent | a name / "the second one" | confirmed → connecting; unconfirmed → asked to confirm, intro waits for their yes |
| | "anyone else?" | a real rematch: fresh request, nobody already contacted |
| | a question about someone | answered only from the profiles shown |
| | a new project | pointed to a new email so the searches stay separate |

**5. Intro and follow-up.** A few minutes after a pick, one email CCs both sides. Three days later each gets a "how was the call?" check-in; a bad call for the client ends in an offered rematch, a bad call for the freelancer goes to the team.

**6. Guardrails on every inbound email** (`inbound-guard.ts`): bounces, auto-replies, the team's own mail, threads Howdy is only CC'd on, and unreadable (attachment-only) emails are never auto-answered — the team gets an alert instead. Freelancers, roster applicants and join requests are never treated as a hiring brief.

**7. Silent sign-ups** get one nudge 48 hours after the welcome email (only sign-ups from the last 14 days).

### Safety switches

- **`HOWDY_OUTREACH_DRYRUN`** (default on): every saga email — invites, shortlists, intros, check-ins, status replies, nudges — is logged, not sent, unless this is exactly `false`. Intake replies (clarifying questions, the "on it" ack, acknowledgements to freelancers writing in) always send.
- **`HOWDY_DRYRUN_ALLOWLIST`**: while dry-run is on, emails whose recipients are all on this list really go out — run the full flow on your own addresses without touching real freelancers.
- **Idempotency**: every step that sends email first claims its state change with a conditional update, so overlapping cron runs and webhook retries can't double-invite or double-send. Duplicate webhook deliveries are skipped.

## Local setup

```bash
npm ci
cp .env.local.example .env.local   # fill in — every variable is documented there
```

Apply `supabase/migrations/0001` → `0006` in the Supabase SQL editor, in order, then seed the roster with `npm run seed:supabase`. Run the site with `npm run dev`.

## Tests

```bash
npm test
```

The suite drives the real route handlers (webhook, cron, signup, chat, applications) with Supabase, AgentMail and Gemini replaced by in-memory fakes (`tests/fakes/`), so the whole flow runs offline in about two seconds. `tests/e2e/saga.test.ts` walks full stories — brief → recruit → shortlist → intro → check-in → rematch — plus routing, the 24-hour fallback, concurrency, dry-run honesty and the guardrails.

The fakes answer structured LLM calls with keyword heuristics (validated against the real schemas). They prove the plumbing and state machine, not the quality of Gemini's judgement.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run seed:supabase` | Embed + push the seeded freelancers |
| `npm run import:freelancers` | Import freelancers from a CSV |
| `npm run applications -- list \| approve <id> \| reject <id>` | Review roster applications |
| `npm run backup:db` / `mirror:backfill` | Local DB backup / backfill the mirror DB |
| `npm run howdy` / `howdy:smoke` / `howdy:multi` | Talk to the agent locally |
| `npm run agentmail:inboxes` | List inboxes the API key can see |

## Going live

In this order:

1. **Run migration `0006`** in Supabase. The cron refuses to run without it.
2. **Set env vars on Vercel** (see `.env.local.example`), including `AGENTMAIL_WEBHOOK_SECRET` — the webhook's `whsec_…` signing secret from AgentMail (`webhooks.get(<id>).secret`). In production the webhook rejects every request until it's set.
3. **Deploy** (merge to `main`).
4. **Scheduler**: something must call `GET /api/howdy/process-pending` with `Authorization: Bearer $CRON_SECRET` every ~15 minutes. The GitHub Actions workflow does this, but GitHub disables scheduled workflows after 60 days without commits — an external scheduler (e.g. cron-job.org) or Vercel Pro cron is more durable. Use one scheduler.
5. **Enable the AgentMail webhook** (`message.received` → `https://<domain>/api/agentmail/webhook`).
6. **Test in dry-run** with your own addresses on `HOWDY_DRYRUN_ALLOWLIST`, then set `HOWDY_OUTREACH_DRYRUN=false`.

## Tweaking behavior

- Required brief fields — `REQUIRED_FIELDS` in `src/lib/howdy/types.ts`; clarifying-turn cap — `MAX_CLARIFY_TURNS` in `assessor.ts`.
- Saga timing — `REPLY_TIMEOUT_HOURS`, `FALLBACK_DELIVERY_HOURS`, `MAX_DEFER_HOURS`, `CHECKIN_DELAY_DAYS` in `types.ts`.
- Nudges — `NUDGE_AFTER_HOURS`, `NUDGE_MAX_AGE_DAYS` in `nudges.ts`.
- Decisions and their reasons — `DECISIONS.md`.
