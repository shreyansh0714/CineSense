# Project Report — CineSense (DRAFT)

> **Status: draft.** Sections marked *(fill in)* need live-deployment details or
> teammate review before submission. Companion documents:
> [`CONCEPT_NOTE.md`](CONCEPT_NOTE.md) · [`PROMPTS.md`](PROMPTS.md) ·
> [`DEPLOYMENT.md`](DEPLOYMENT.md)

**Team:** Arnav (core application) · Shreyansh Jain (AWS deployment, testing, documentation)
**Repo:** https://github.com/Arnav-77/CineSense

---

## 1. What CineSense is

An AI movie recommendation engine built on a simple inversion: instead of
asking *what genre do you want*, it asks *how do you feel* and *what have you
loved, and why*. A single LLM prompt turns those two signals into one confident,
explained recommendation, refined conversationally until it lands. Full concept
and target user: [`CONCEPT_NOTE.md`](CONCEPT_NOTE.md).

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS (`static/`) | Zero build step; responsive mobile-first CSS; SSE + progressive rendering need no framework |
| Backend | FastAPI + uvicorn (`app/main.py`) | Async-native, so streaming an upstream LLM to the browser is a few lines; Pydantic gives input validation for free |
| LLM | Google Gemini `gemini-flash-latest`, official `google-genai` SDK | Free tier covers the whole project; fast enough that streaming feels live; official SDK handles auth from an env var |
| Transport | Server-Sent Events | One-directional token streaming is exactly SSE's use case; simpler than WebSockets, works through HTTPS proxies |
| State | In-memory dict, session-ID keyed | Honest scale-appropriate choice; see Challenges §6 for the trade-off and its deployment consequence |
| Container | Docker (python:3.12-slim) | Identical artifact locally and in production |
| Hosting | AWS EC2 free tier + Caddy | The project must deploy at **zero cost**; App Runner (our original choice) has no free tier. A `t2.micro`/`t3.micro` instance is free for 750 hrs/month, and Caddy + a free `nip.io` hostname gives real HTTPS without buying a domain — full rationale table in [`DEPLOYMENT.md`](DEPLOYMENT.md) §0 |

## 3. Architecture

```
Browser (static/index.html + app.js)
   │  POST /api/recommend {mood, favorites[], constraints}
   │  POST /api/refine    {session_id, message}          ← conversational loop
   │  ◄── SSE stream: session → delta* → done | error
FastAPI (app/main.py)
   │  sessions: dict[session_id → message history]   (in-memory, max 1 instance)
   │  full history resent each turn → multi-turn coherence
Gemini API (system prompt from app/prompts.py, temperature 0.7, ≤4096 tokens)
```

Design points worth defending:

- **The key never leaves the server.** The browser talks only to our backend;
  `GEMINI_API_KEY` exists solely as a server env var (the `docker run -e`
  command on the EC2 instance in production, gitignored `.env` locally).
- **Sessions are server-side.** The frontend holds only an opaque session ID;
  the full conversation history lives (and is capped: 500 sessions, 40 turns)
  in the backend, and is replayed to Gemini each turn so refinements have
  complete context.
- **Errors fail soft.** Upstream failures (rate limit, bad key) are streamed to
  the UI as typed SSE `error` events with actionable messages instead of
  crashing the request — this later made deployment misconfiguration
  self-diagnosing (§6).

## 4. Prompting strategy

The full design rationale and revision log live in [`PROMPTS.md`](PROMPTS.md);
the live prompt is `app/prompts.py`. Summary of the three techniques combined
in the single system prompt:

1. **Taste-signal extraction** — the model is instructed to mine the user's
   *"why I loved it"* free text for underlying signals, with a worked example
   in the prompt (*Whiplash → obsession/intensity, not "music movies"*).
   Without the example, early drafts genre-matched.
2. **Mood as a separate axis** — one load-bearing sentence: *"taste tells you
   what they love, mood tells you what they can handle TONIGHT."* This is what
   stops the model recommending Kubrick to someone who is exhausted.
3. **Fixed reasoning-first output shape** — `## Reading you` →
   `## Tonight's pick` → `## If that's not it`, enforced every turn. The
   interpretation streams in before the title appears.

Sample first-turn message (the intake form is serialized into labelled
sections so mood text and taste text can't blur):

```
MOOD / CONTEXT: fried after a 10-hour shift, zero brainpower left

TASTE PROFILE:
- Whiplash — why I loved it: the obsession, I couldn't breathe during the last scene
- Paddington 2 — why I loved it: pure warmth, every character is kind

CONSTRAINTS: under 2 hours
```

*(fill in: edge-case test results — vague moods, contradictory taste,
constraint violations, repeat-suggestion behavior over 5+ refinement turns —
and any resulting prompt revisions from the PROMPTS.md table)*

## 5. Development summary (phase by phase)

| Phase | Work | Owner |
|---|---|---|
| 1. Concept & prompt design | Recommendation concept, system-prompt v1 with the three techniques above, `docs/PROMPTS.md` rationale | Arnav |
| 2. Backend | FastAPI app: session store, SSE streaming endpoints, Gemini integration, input validation, soft error handling | Arnav |
| 3. Frontend | Responsive intake form + chat view, SSE parsing, progressive markdown rendering, refinement loop | Arnav |
| 4. Containerization | Dockerfile (python:3.12-slim, port 8080), local Docker verification | Arnav |
| 5. Deployment prep | Environment verification, Dockerfile fix, App Runner runbook — then revised to EC2 free tier after confirming App Runner isn't actually free ([`DEPLOYMENT.md`](DEPLOYMENT.md)) | Shreyansh |
| 6. AWS deployment | EC2 free-tier instance, Elastic IP, Docker, Caddy + nip.io HTTPS, budget alert, end-to-end verification | Shreyansh — *(fill in date + URL)* |
| 7. Testing & report | Edge-case prompt testing, revision log entries, this report | Shreyansh + Arnav |

## 6. Challenges & resolutions

| Challenge | Resolution |
|---|---|
| Early prompt drafts **genre-matched** instead of extracting taste ("loved Whiplash" → music movies) | Added an explicit worked example to the system prompt showing signal extraction; documented in PROMPTS.md |
| Exhausted users were recommended their **favorite heavy films** | Separated mood from taste in the prompt: mood gates what the user *can handle tonight* |
| **In-memory sessions vs. horizontal scaling**: any second instance/container would hold a disjoint session store, so refinements would randomly 404 | Deliberately run exactly **one** container on **one** EC2 instance — matches the in-memory design instead of fighting it (documented trade-off; Redis/DynamoDB is the production path) |
| Stale `ANTHROPIC_API_KEY` comment in the Dockerfile (leftover from a template) while the app reads `GEMINI_API_KEY` | Caught in deployment prep review; fixed so the deploy docs and image agree |
| **AWS App Runner, our original hosting choice, has no free tier** (~$2.5–3/month) — the course brief requires deployment at zero cost | Switched the plan to an AWS **EC2 free-tier instance** (750 free hrs/month, enough for one instance running continuously) before any money was spent; documented the full rationale in DEPLOYMENT.md §0 |
| EC2 gives a raw IP, not a domain — but the brief expects a public **HTTPS** URL, and buying a domain costs money | Used a free `nip.io` hostname (resolves `<ip-with-dashes>.nip.io` back to the instance's IP) with Caddy as a reverse proxy, which gets a real, free Let's Encrypt certificate for that hostname automatically |
| A stopped EC2 instance's Elastic IP quietly starts costing money (only free while attached to a *running* instance) | Documented as a specific gotcha in DEPLOYMENT.md §10; since 750 free hours/month covers one instance running 24/7, the simplest safe choice is to just leave it running rather than stop/start it |
| *(fill in: real issues from the live deployment — DEPLOYMENT.md §11 table)* | |

## 7. Learnings

- **Prompt structure beats prompt length.** The three biggest behavior fixes
  (signal extraction, mood gating, reasoning-first) were each one sentence or
  one example — placed precisely — not paragraphs of instructions.
- **Streaming is a UX feature, not a performance feature.** Reasoning-first +
  SSE turns latency into anticipation: the user watches themselves being
  understood while the model is still generating.
- **State is where deployment bites.** The one in-memory dict — invisible
  locally — dictated the entire scaling configuration in production. "Where
  does state live?" is the first deployment question, not the last.
- **Soft failure pays for itself.** Streaming typed error events instead of
  crashing made the most likely production mistake (a bad API key) diagnose
  itself in the UI.
- **Document decisions when you make them.** The rationale tables in
  DEPLOYMENT.md and PROMPTS.md were written alongside the work — this report
  mostly assembled existing material, which is the cheapest a report ever gets.
- *(fill in: personal learnings from each teammate)*

## 8. AI-assisted workflow (vibe-coding log)

Prompt documentation for the AI-assisted process itself:

- The system prompt engineering log: [`PROMPTS.md`](PROMPTS.md).
- The deployment deliverable was driven through Claude Code with a structured
  handoff brief ([`HANDOFF_SHREYANSH.md`](HANDOFF_SHREYANSH.md)); prompts and
  outcomes for that session are logged in [`DEPLOYMENT.md`](DEPLOYMENT.md) §9.
- *(fill in: Arnav's prompts/workflow for phases 1–4)*
