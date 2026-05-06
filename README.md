# Howdy

An AI freelancer-matching service that lives entirely inside an email inbox. A hirer signs up on the marketing site, gets a welcome email from `howdyai@agentmail.to`, and from then on Howdy acts as their personal talent scout — asking clarifying questions over email and replying with a single vetted match.

This repo holds both halves: the marketing site and the agent backend, deployed as one Next.js app on Vercel.

Live: https://howdy-ai-zeta.vercel.app

---

## What's in here

```
src/
├── app/
│   ├── page.tsx                          ← marketing landing page
│   └── api/
│       ├── lead/route.ts                 ← form submission → AgentMail welcome email
│       ├── agentmail/webhook/route.ts    ← inbound email handler
│       └── howdy/process-pending/route.ts← cron-driven scheduled-match worker
├── components/                           ← marketing UI + dialogs (Hire, Contact)
└── lib/
    ├── howdy/                            ← LangGraph agent, matcher, scheduler, memory
    ├── agentmail/                        ← AgentMail SDK wrapper (send / reply / parse)
    └── supabase/                         ← Supabase admin client
data/freelancers.json                     ← 20 seeded freelancers
supabase/migrations/                      ← pgvector schema + leads table
scripts/                                  ← CLI helpers (smoketest, seed, listener)
.github/workflows/howdy-cron.yml          ← every-minute cron via GitHub Actions
```

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) on Vercel |
| Styling | Tailwind v4, shadcn/ui (Radix), `tw-animate-css` |
| Typography | Instrument Serif + Geist Mono via `next/font/google` |
| Agent | LangGraph.js + LangChain core |
| LLM | Gemini `gemini-flash-latest` |
| Embeddings | Gemini `gemini-embedding-001` (768 dims) |
| Vector DB | Supabase Postgres + pgvector |
| Email API | [AgentMail](https://agentmail.to) (send / reply / WebSocket / webhook) |
| Cron (production) | GitHub Actions (Vercel Hobby caps at daily) |

## How the agent works

```
user emails howdyai@agentmail.to
        │
        ▼
AgentMail webhook → /api/agentmail/webhook
        │
        ▼
findOrCreateThread() → loadMessages() → loadMemories(userEmail)
        │
        ▼
LangGraph state machine (src/lib/howdy/agent.ts):

  START
   │
   ▼
  extract  ── extracts a structured Brief (Zod schema) from the
   │           full conversation, merging with prior turns
   ▼
  decide   ── briefIsActionable() requires 6+ fields incl. one
   │           specificity signal (stack/refs/must_haves) and one
   │           constraint signal (deadline/budget)
   │
   ├── not actionable → clarify ── ask one priority question, END
   │
   └── actionable → schedule ── pick random time in 9–16 window,
                                save to pending_matches, ack + END

(later, when the scheduled time arrives)

GitHub Actions cron → /api/howdy/process-pending
        │
        ▼
runScheduledMatch(brief)
   │
   ├── findBestMatch():  hard filter (budget/tz)
   │                  → vector search (cosine over 768-d embeddings)
   │                  → LLM rerank top-5 with confidence
   │
   └── composeMatchReply() drafts the proposal, AgentMail sends it
       in the same thread, saveMemories() persists role/budget/refs
       so the next conversation starts smarter.
```

### Why deferred matching?

Instant LLM replies feel robotic. The scheduler picks a uniformly-random time inside a configurable business window (default 9 AM – 4 PM, `crypto.randomInt`) and a worker drains the queue at that moment, so messages arrive on a human cadence. See `pickRandomMatchTime` in `src/lib/howdy/scheduler.ts`.

### Memory

`memories` table stores per-user facts (name, company, prior role hired, typical budget, style refs). Loaded on every turn and injected into both the brief-extraction and clarify prompts so Howdy never re-asks something it already knows.

## Local setup

1. Clone and install:
   ```bash
   git clone https://github.com/npmiaman/BCHowdy.git
   cd BCHowdy
   npm install
   ```
2. Copy env template and fill in the keys you have:
   ```bash
   cp .env.local.example .env.local
   ```

| Var | Where to get it |
|---|---|
| `GOOGLE_API_KEY` | https://aistudio.google.com/apikey |
| `AGENTMAIL_API_KEY` | https://console.agentmail.to |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same screen, the secret key |
| `CRON_SECRET` | Any random string (`openssl rand -hex 32`) |

3. Apply the Supabase schema (one-time): paste `supabase/migrations/0001_init.sql` then `supabase/migrations/0002_leads.sql` into the Supabase SQL editor and run.
4. Seed freelancers (one-time):
   ```bash
   npm run seed:supabase
   ```
5. Run the marketing site:
   ```bash
   npm run dev
   ```
6. (Optional) Test the agent end-to-end without deploying — the WebSocket listener subscribes to your AgentMail inbox and replies via the API:
   ```bash
   npm run howdy:listen
   ```
   Then email `howdyai@agentmail.to` from any address.

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Marketing site dev server |
| `npm run build` | Production build |
| `npm run howdy` | Interactive CLI to chat with the agent locally |
| `npm run howdy:smoke` | One-shot agent dry run (sends a brief, prints the reply) |
| `npm run howdy:multi` | Multi-turn dry run (vague → schedule → match) |
| `npm run howdy:distribution` | Histogram of 200 random match times to verify uniformity |
| `npm run howdy:listen` | WebSocket listener: sends agent replies for real inbound mail |
| `npm run seed:supabase` | Embed + push the 20 freelancer seeds |
| `npm run agentmail:inboxes` | List inboxes the API key can see |

## Production deploy

1. **Vercel** — import the repo, add every env var from `.env.local` to the project's Environment Variables, deploy.
2. **AgentMail webhook** — in the AgentMail console, set the inbox webhook URL to `https://<your-vercel-url>/api/agentmail/webhook` and subscribe to `message.received`.
3. **Cron** — Vercel Hobby caps cron at once-daily, so the every-minute drain runs from a free GitHub Actions workflow (`.github/workflows/howdy-cron.yml`). Set two repo secrets at GitHub → Settings → Secrets and variables → Actions:
   - `HOWDY_DEPLOYMENT_URL` — the Vercel URL (no trailing slash)
   - `CRON_SECRET` — same value as on Vercel

## Tweaking behavior

- **Match-window hours** — `HOWDY_BUSINESS_HOURS_START` / `HOWDY_BUSINESS_HOURS_END` (defaults 9 / 16).
- **Brief actionability bar** — `briefIsActionable` in `src/lib/howdy/extractor.ts` controls how many fields are required before the agent stops asking and schedules a match.
- **Clarify priority order** — `CLARIFY_SYSTEM_PROMPT` in `src/lib/howdy/agent.ts` lists which missing field to ask about next.
- **Welcome email copy** — `welcomeBody()` in `src/app/api/lead/route.ts`.

## Acknowledgements

Built with help from Claude. The pixel-art Howdy mascot was drawn by hand (or someone's AI version of a hand) and lives at `public/howdy-logo.png`.
