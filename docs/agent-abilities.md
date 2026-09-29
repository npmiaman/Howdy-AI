# Howdy agent: abilities plan

What the agent needs in order to feel like a sharp human talent scout rather than a form with an LLM behind it. Each ability is grounded in something we saw in real threads, and each one ships with tests.

## 1. Sound like a person (voice layer)
**Why:** early replies read as AI: "Got your match. **Yuki Tanaka**", markdown bold in plain-text email, stock openers. The team had already stripped em dashes from the welcome email by hand.
**What:**
- One voice guide appended to every writing prompt. It adapts the 26 patterns of [blader/humanizer](https://github.com/blader/humanizer) (MIT), built on Wikipedia's *Signs of AI writing*, to short business email.
- Every AI-written message is scored by [brandonwise/humanizer](https://github.com/brandonwise/humanizer) (MIT, a zero-dependency scanner) plus Howdy's own checks: dashes, markdown, stock openers and closers.
- Over the threshold, the message gets one targeted rewrite (about 1s), and the cleaner version is sent.
- Fixed copy is rewritten by hand to the same rules.
- A live before/after check lives in `npm run howdy:voice-check`.

## 2. Understand faster
- **Ask up to two related questions per email** (e.g. deadline + budget), with simple example options. Fewer round trips; Bernice's hand-written emails already did this.
- **Reply in the client's language.**
- **See attachments.** Filenames go into the conversation, so Howdy can refer to "the 4 logo refs you sent". Attachment-only emails still go to a human.

## 3. Handle more situations
- **Answer freelancers' questions** ("what's the budget?") from the anonymised brief, then ask for their yes or no. Today they just get "yes or no?".
- **Know when to hand over:** a client who is upset, asks for a person, or raises payment, refund, pricing, contract or legal questions. Howdy sends a short holding reply, pauses the conversation, and alerts the team. This is folded into the existing classifiers, so it costs no extra AI calls.

## 4. Remember
- When a brief completes, save durable facts to the client's memory: role, budget, style, industry.
- After a check-in, save who they did or didn't click with and why, so the next search starts smarter.

## 5. Keep people informed
- One honest progress note if recruiting runs long (8h+ with no shortlist): how many have confirmed, and the shortlist deadline.

## 6. Guardrails before sending
- **Anonymisation check:** a freelancer pitch that mentions the client's company or email domain falls back to fixed wording.
- Missing rates read "rate on request" (done).
- The voice check (ability 1).

## Later (not in this round)
Reading image attachments with a vision model, human-paced send times via scheduled sends, ranking that learns from check-in outcomes, WhatsApp.

## Status
| # | Ability | Status |
|---|---|---|
| 1 | Voice layer | planned |
| 2 | Two-question asks · language mirroring · attachments | planned |
| 3 | Freelancer Q&A · human hand-over | planned |
| 4 | Memory write-back | planned |
| 5 | Progress note | planned |
| 6 | Anonymisation check | planned |
