"""CineSense — AI movie recommendation engine.

FastAPI backend: holds per-session conversation state in memory and streams
Gemini responses to the frontend over Server-Sent Events (SSE).
"""

import json
import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field

from app.prompts import SYSTEM_PROMPT, build_first_turn

load_dotenv()  # local dev: reads .env; on App Runner the env var is set in the service config

MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
MAX_SESSIONS = 500          # oldest sessions evicted beyond this
MAX_TURNS_PER_SESSION = 40  # message-list length cap per session

app = FastAPI(title="CineSense")

# session_id -> list of {"role": "user"|"assistant", "content": str}
sessions: dict[str, list] = {}

_client: genai.Client | None = None


def get_client() -> genai.Client:
    """Lazy singleton — created on first use so a missing GEMINI_API_KEY
    surfaces as a clean SSE error instead of crashing the server at import."""
    global _client
    if _client is None:
        _client = genai.Client()  # key from GEMINI_API_KEY — never in code
    return _client


class Favorite(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    why: str = Field(default="", max_length=1000)


class RecommendRequest(BaseModel):
    mood: str = Field(min_length=1, max_length=1000)
    favorites: list[Favorite] = Field(min_length=1, max_length=3)
    constraints: str = Field(default="", max_length=500)


class RefineRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=2000)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def to_gemini_contents(messages: list) -> list:
    """Convert our neutral history format to Gemini Content objects
    (Gemini uses role "model" where Anthropic-style history says "assistant")."""
    return [
        types.Content(
            role="user" if m["role"] == "user" else "model",
            parts=[types.Part(text=m["content"])],
        )
        for m in messages
    ]


async def stream_session_reply(session_id: str):
    """Send the session's full history to Gemini and stream the reply as SSE."""
    messages = sessions[session_id]
    yield sse("session", {"id": session_id})
    parts: list[str] = []
    try:
        stream = await get_client().aio.models.generate_content_stream(
            model=MODEL,
            contents=to_gemini_contents(messages),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                max_output_tokens=4096,
                temperature=0.7,
            ),
        )
        async for chunk in stream:
            if chunk.text:
                parts.append(chunk.text)
                yield sse("delta", {"text": chunk.text})
    except errors.APIError as e:
        if e.code == 429:
            yield sse("error", {"message": "Free-tier rate limit hit — wait a minute and try again."})
        elif e.code in (401, 403) or "api key" in str(e).lower():  # Gemini reports a bad key as 400
            yield sse("error", {"message": "API key missing or invalid — check GEMINI_API_KEY on the server."})
        else:
            yield sse("error", {"message": f"Upstream API error ({e.code}). Try again."})
        return
    except Exception:  # e.g. missing GEMINI_API_KEY raises at client creation
        logging.exception("Unexpected error while streaming from the model API")
        yield sse("error", {"message": "Server misconfiguration — is GEMINI_API_KEY set?"})
        return
    # Persist the assistant turn so refinements see the full conversation
    messages.append({"role": "assistant", "content": "".join(parts)})
    yield sse("done", {})


def new_session(first_message: str) -> str:
    if len(sessions) >= MAX_SESSIONS:
        sessions.pop(next(iter(sessions)))  # evict oldest (dict preserves insertion order)
    session_id = uuid.uuid4().hex
    sessions[session_id] = [{"role": "user", "content": first_message}]
    return session_id


@app.post("/api/recommend")
async def recommend(req: RecommendRequest):
    first = build_first_turn(req.mood, req.favorites, req.constraints)
    session_id = new_session(first)
    return StreamingResponse(
        stream_session_reply(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/refine")
async def refine(req: RefineRequest):
    messages = sessions.get(req.session_id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Session not found or expired — start over.")
    if len(messages) >= MAX_TURNS_PER_SESSION:
        raise HTTPException(status_code=409, detail="Session is full — start a new one.")
    messages.append({"role": "user", "content": req.message})
    return StreamingResponse(
        stream_session_reply(req.session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": MODEL, "active_sessions": len(sessions)}


# Serve the frontend at the root (html=True makes "/" return index.html).
# API routes above are registered first, so they take precedence.
app.mount("/", StaticFiles(directory="static", html=True), name="static")
