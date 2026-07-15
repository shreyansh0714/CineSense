# Concept Note — CineSense

**Course:** Vibe Coding Masterclass
**Team:** Arnav (core application) · Shreyansh Jain (deployment, testing, documentation)
**Repo:** https://github.com/Arnav-77/CineSense

## Title

**CineSense** — an AI movie recommendation engine that reads your mood and your
taste, explains its reasoning first, and refines its pick in conversation.

## Problem statement

Every existing recommendation surface asks the wrong question. Streaming
platforms ask *"what genre?"* and optimize for engagement, not fit; rating sites
assume you know what you want. But the real question on a weeknight is
*"what can I handle tonight?"* — a function of **mood** (exhausted, restless,
wanting to argue about something) crossed with **taste** (what you actually
love about the films you love, which is almost never the genre). The result is
the familiar 40 minutes of scrolling followed by rewatching something safe.

## Target user

Anyone who knows 2–3 movies they loved and can say why, but doesn't know what
to watch *tonight*: tired professionals after work, couples negotiating a pick,
film-curious students who find genre menus meaningless. No film literacy
required — the interface asks for feelings, not vocabulary.

## LLM / API used

**Google Gemini** (`gemini-flash-latest`) via the official `google-genai`
Python SDK, called server-side from a FastAPI backend with streaming enabled.
The free tier covers the full demo workload; the API key lives only in a
server-side environment variable (never in code or the frontend).

## Key features

1. **Mood + taste intake, not genre menus** — the user describes how they feel
   and names 2–3 movies they loved *and why*; the model extracts underlying
   taste signals (pacing, intensity, warmth, moral complexity) from the "why"
   text.
2. **Reasoning-first reveal** — the response always opens with a "Reading you"
   interpretation *before* naming the pick, so the user watches the system
   understand them; trust precedes the recommendation.
3. **One confident pick + one backup** — no hedging lists of ten titles.
4. **Conversational refinement** — plain-language pushback ("too heavy",
   "seen it", "similar but funnier") is treated as new taste signal; the
   engine never repeats a suggestion within a session.
5. **Live streaming UX** — responses stream token-by-token over Server-Sent
   Events, giving the reasoning section a natural dramatic arc.
6. **Hard constraints honored** — "under 2 hours", "no horror", "on Netflix"
   are treated as filters that are never violated for a "better" fit.

## Expected user experience

The user opens a single clean page (works equally on phone and desktop), types
a mood in their own words, adds two or three loved movies with a sentence on
why, optionally a constraint — and hits go. Within a second, text starts
streaming: first the system's read of *them*, then one pick with the reasoning
already on the table, then a backup. If the pick isn't right, they say so the
way they'd tell a friend, and the next pick arrives already corrected. Total
time from open to committed choice: under two minutes, versus the 40-minute
scroll it replaces.

## Deployment target

Docker container on a free-tier **AWS EC2** instance (`t2.micro`/`t3.micro`),
with a public HTTPS URL via Caddy + a free `nip.io` hostname — chosen
specifically because it costs **$0**, unlike AWS App Runner which has no free
tier. `GEMINI_API_KEY` is set only in the server-side `docker run` command,
never in the repo; a $5/month budget alert is a safety net. Full procedure and
rationale in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
