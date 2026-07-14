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
Docker → AWS App Runner (public HTTPS URL)
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

## Deploy to AWS App Runner

App Runner runs a container behind a public HTTPS URL with no servers to manage.
Two paths; ECR is the reliable one:

### 1. Push the image to ECR

```sh
aws ecr create-repository --repository-name cinesense --region ap-south-1
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com
docker build -t cinesense .
docker tag cinesense:latest <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/cinesense:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/cinesense:latest
```

### 2. Create the App Runner service (Console)

1. AWS Console → **App Runner** → *Create service*
2. Source: **Container registry / Amazon ECR** → pick the `cinesense:latest` image
3. Deployment: manual (free-tier friendly) — redeploy by pushing a new image
4. Service settings: **Port 8080**, smallest instance (0.25 vCPU / 0.5 GB is plenty)
5. **Environment variables → add `GEMINI_API_KEY`** with your key
   (this is the "no keys in code" requirement — the key lives only in service config)
6. Create → wait for the green *Running* state → copy the `https://xxxx.awsapprunner.com` URL
7. Smoke test: open `<url>/api/health`, then run a full recommendation flow

### 3. Budget alert (required by the brief)

AWS Console → **Billing → Budgets → Create budget** → Cost budget → e.g. $5/month
→ email alert at 80%. Do this *before* leaving the service running.

### Notes / honest limitations

- Session state is **in-memory**: a container restart or scale-out loses active
  conversations. Fine at this scale; the report should name this as a deliberate
  trade-off (a Redis/DynamoDB session store is the production path).
- App Runner may run multiple instances if scaled; keep max instances = 1 so
  every request hits the same in-memory store.

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
