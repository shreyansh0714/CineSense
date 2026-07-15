# CineSense — AI Movie Recommendation Engine

Mood + deep taste profiling + conversational refinement, in one reasoning engine.
The AI explains *why* a movie fits you **before** revealing the pick, and streams
its reasoning live.

```
Frontend (HTML/CSS/JS, responsive)
      │ HTTPS + Server-Sent Events
FastAPI backend (Python) — in-memory conversation state per session
      │ server-side only, key in env var
Gemini API (streaming)
      │
Docker → AWS EC2 (free tier, public HTTPS URL via Caddy + nip.io)
```

## Features → assignment requirements

| Requirement | Where |
|---|---|
| Responsive frontend | `static/` — mobile-first CSS, works on phone + desktop |
| FastAPI backend | `app/main.py` |
| LLM API integration | Google Gemini via official `google-genai` SDK (`gemini-flash-latest` by default) |
| Streaming responses | SSE: backend streams `delta` events, frontend renders progressively (`static/app.js`) |
| Multi-turn conversation | Server-side session dict keyed by UUID; full history resent each turn |
| Containerized | `Dockerfile` |
| No keys in frontend/repo | Key read from `GEMINI_API_KEY` env var only; `.env` gitignored |
| Prompt documentation | `docs/PROMPTS.md` (feeds the project report) |

## Run locally

```sh
python -m venv .venv
.venv\Scripts\activate          # Windows (source .venv/bin/activate on mac/linux)
pip install -r requirements.txt
copy .env.example .env          # then paste your real GEMINI_API_KEY into .env
uvicorn app.main:app --reload --port 8080
```

Open http://localhost:8080

**Cost note:** the app runs entirely on the Gemini **free tier** — get a key at
[aistudio.google.com](https://aistudio.google.com) with a Google account, no card
needed. Free-tier rate limits are far above what a demo or evaluation needs.

## Run with Docker

```sh
docker build -t cinesense .
docker run -p 8080:8080 -e GEMINI_API_KEY=your-key cinesense
```

## Deploy to AWS (EC2 free tier)

**AWS App Runner has no free tier** (~$2.5–3/month) — since this project must
deploy at **zero cost**, we run the container on a free-tier-eligible EC2
instance instead, with free automatic HTTPS via Caddy + a
[nip.io](https://nip.io) hostname (no domain purchase needed).

**Full step-by-step runbook (exact commands, budget alert, verification
checklist, troubleshooting): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).**

Quick version:

1. Launch a `t2.micro`/`t3.micro` EC2 instance (Amazon Linux 2023, free-tier eligible), open ports 22/80/443
2. Allocate + associate an Elastic IP (free while attached to a running instance)
3. SSH in, install Docker, `git clone` this repo, `docker build -t cinesense .`
4. `docker run -d --name cinesense --restart unless-stopped -p 127.0.0.1:8080:8080 -e GEMINI_API_KEY=your-key cinesense`
   (bound to localhost — the key lives only in this command, never in the repo)
5. Install Caddy, point it at `<your-ip-with-dashes>.nip.io`, reverse-proxy to `localhost:8080` — Caddy gets a free real HTTPS certificate automatically
6. Smoke test: `https://<your-ip>.nip.io/api/health`, then a full recommendation flow
7. **Budget alert (required by the brief):** AWS Console → **Billing → Budgets → Create budget** → Cost budget → $5/month → email alert at 80%

### Notes / honest limitations

- Session state is **in-memory**: a container restart loses active
  conversations. Fine at this scale; the report names this as a deliberate
  trade-off (a Redis/DynamoDB session store is the production path).
- Only **one** instance/container runs, by design — matches the in-memory session store.
- 750 free hours/month covers one instance running continuously all month; no
  need to stop/start it between demos (see `docs/DEPLOYMENT.md` §10).

## Project structure

```
app/
  main.py        FastAPI app: sessions, SSE streaming endpoints
  prompts.py     System prompt + first-turn message builder (single source of truth)
static/
  index.html     Intake form + chat view
  style.css      Responsive styles
  app.js         SSE parsing, progressive markdown rendering, refinement loop
docs/
  PROMPTS.md     Prompt design rationale + revision log (report material)
Dockerfile
requirements.txt
```

## API

| Route | Method | Body | Returns |
|---|---|---|---|
| `/api/recommend` | POST | `{mood, favorites:[{title, why}], constraints}` | SSE stream: `session` → `delta`* → `done` |
| `/api/refine` | POST | `{session_id, message}` | SSE stream: `session` → `delta`* → `done` |
| `/api/health` | GET | — | `{status, model, active_sessions}` |
