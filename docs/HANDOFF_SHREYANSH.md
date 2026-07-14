# Handoff prompt — paste everything below this line into Claude Code

---

I'm Shreyansh Jain (GitHub: shreyansh0714), one of two teammates on **CineSense**,
a college project for a "Vibe Coding Masterclass". My teammate Arnav built the
core app; I own the remaining deliverables. This message explains the project,
what's already done, and exactly what my responsibilities are. Help me execute
them step by step, and document any prompts we use along the way (prompt
documentation is graded).

## The project

CineSense is an AI movie recommendation engine — instead of picking a genre, the
user describes their **mood** ("fried after work") and 2–3 **movies they loved
and why**; the AI extracts underlying taste signals, explains its reasoning
FIRST, then reveals one pick, and the user refines conversationally ("too heavy",
"seen it"). Repo: https://github.com/Arnav-77/CineSense (I have a synced fork
and collaborator access).

Architecture (all working, live-tested):

```
Responsive frontend (static/ — vanilla HTML/CSS/JS)
   │ HTTPS + Server-Sent Events (streaming)
FastAPI backend (app/main.py) — in-memory session state per conversation
   │ key server-side only, from GEMINI_API_KEY env var
Gemini API (google-genai SDK, model gemini-flash-latest, free tier)
   │
Dockerfile ready → NOT YET DEPLOYED to AWS   ← my job
```

Key files: `app/main.py` (SSE endpoints `/api/recommend`, `/api/refine`,
`/api/health`), `app/prompts.py` (system prompt — single source of truth),
`docs/PROMPTS.md` (prompt revision log, must stay in sync with prompts.py),
`README.md` (run + deployment instructions).

## Assignment requirements that are still open (my responsibilities)

The submission is graded: Technical/vibe-coding 25%, Prompt engineering &
documentation 20%, **AWS deployment 20%**, Design/UX 20%, Report 15%.

### 1. Deploy to AWS App Runner (my main task, 20% of grade)
- Prereqs on my machine: Docker Desktop, AWS CLI, an AWS account (free tier).
- Follow README.md "Deploy to AWS App Runner": build the Docker image, push to
  ECR, create an App Runner service — **port 8080**, environment variable
  `GEMINI_API_KEY` set in the service config (never in code), **max instances
  = 1** (session state is in-memory).
- Set an AWS **budget alert** (e.g. $5/month, email at 80%) — explicitly
  required by the course brief.
- Verify the public HTTPS URL end-to-end (`/api/health`, then a full
  recommendation + refinement flow).
- Commit deployment documentation to the repo under my name: exact commands
  used, screenshots folder if useful, any issues + fixes (this feeds the
  "challenges & resolutions" section of the report).

### 2. Prompt iteration & testing (shared, 20% of grade)
- Run the app locally, try edge cases: vague moods, contradictory taste
  ("I love slow cinema" + "I get bored easily"), constraint violations, many
  refinement turns (does it repeat suggestions?).
- When we change `app/prompts.py`, log every revision in `docs/PROMPTS.md`
  (what changed, what behavior it fixed) — there's a table waiting for entries.

### 3. Report documents (15% of grade)
- Draft the **Concept Note** (title, problem statement, target user, LLM/API
  used = Gemini, key features, expected UX) and the **Project Report** (tech
  stack, prompting strategy with samples from docs/PROMPTS.md, phase-by-phase
  dev summary, architecture, challenges + resolutions, learnings). Commit
  drafts under `docs/` so both teammates' contributions are in git history.

## My local setup (do this first)

```sh
git clone https://github.com/Arnav-77/CineSense.git   # or my synced fork
cd CineSense
python -m venv .venv && .venv\Scripts\activate        # (Windows)
pip install -r requirements.txt
copy .env.example .env    # then paste MY OWN free Gemini key (aistudio.google.com)
uvicorn app.main:app --reload --port 8080             # open http://localhost:8080
```

## Working rules (important)

- **Never commit `.env` or any API key.** It's gitignored — keep it that way.
- Commit under my own identity (`git config user.email` = the email on my
  GitHub account) so the contributor history shows both teammates.
- Work on branches and open PRs to `main` (or push directly — but PRs look
  better for the graded collaboration story).
- Course rule: each teammate must be able to explain EVERY decision
  independently — so when you (Claude) make a choice for me, explain the why,
  not just the how.

Start by helping me verify my local setup runs, then move to task 1 (AWS).
