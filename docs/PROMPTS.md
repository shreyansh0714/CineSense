# Prompt Engineering Log — CineSense

This document tracks every prompt revision and the reasoning behind it. It is the
source material for the "Prompting strategy" section of the project report.
The live prompt lives in [`app/prompts.py`](../app/prompts.py) — keep the two in sync.

---

## Design goals for the system prompt

The concept combines three techniques in a single prompt, so the prompt has to do
three jobs at once:

1. **Taste extraction, not genre matching.** The user gives movies *and why they
   loved them*. The prompt explicitly instructs the model to extract underlying
   signals (pacing, tone, moral complexity, obsession, visual style) from the
   "why" text and gives a worked example (*Whiplash → obsession/intensity, not
   "music movies"*). Without that example, early drafts genre-matched.
2. **Mood as a separate axis.** Mood and taste are given *different roles*:
   "taste tells you what they love, mood tells you what they can handle TONIGHT."
   This one sentence is what stops the model from recommending heavy favorites
   to exhausted users.
3. **Reasoning-first output.** The response shape is fixed:
   `## Reading you` (interpretation) → `## Tonight's pick` (reveal) →
   `## If that's not it` (backup + refinement invitation). Forcing the reasoning
   section *first* builds trust and gives streaming a natural arc — the user
   watches the model "get" them before the title appears.

Multi-turn refinement is handled by conversation state on the backend (full
message history is resent each turn) plus prompt rules: treat feedback as new
signal, never repeat a suggestion, refocus `## Reading you` on what the feedback
taught the model.

## Structured first turn

The intake form is serialized into a labelled message
(`build_first_turn` in `app/prompts.py`):

```
MOOD / CONTEXT: fried after a 10-hour shift, zero brainpower left

TASTE PROFILE:
- Whiplash — why I loved it: the obsession, I couldn't breathe during the last scene
- Paddington 2 — why I loved it: pure warmth, every character is kind

CONSTRAINTS: under 2 hours
```

Labelled sections keep the model from confusing mood text with taste text, and
make refinement turns (plain free text) visually distinct in the history.

## Example output (reasoning-first shape)

> ## Reading you
> You're running on empty, so tonight is not the night for anything that demands
> the intensity you loved in Whiplash. What both your picks share is *emotional
> commitment* — one obsessive, one warm. Exhausted-you needs the Paddington side
> of your taste: sincerity without effort.
>
> ## Tonight's pick
> **School of Rock (2003)** — Jack Black weaponizes obsession for pure joy.
> It scratches the same "someone who cares way too much" itch as Whiplash, but
> the stakes are a battle of the bands instead of a nervous breakdown. 109
> minutes, zero brainpower required. Check your services.
>
> ## If that's not it
> **Chef (2014)** — same warmth, plus food. Tell me if you want something even
> lighter, or push back in plain language.

## Revision log

| Version | Change | Why |
|---|---|---|
| v1 | Initial prompt: role, three labelled inputs, taste-signal extraction with Whiplash example, mood-vs-taste rule, fixed 3-section output shape, refinement rules, ~250-word cap | Baseline combining all three techniques |
| | *(add each revision here as you iterate — what changed, what behavior it fixed)* | |

### Ideas queued for future revisions
- Test whether the model respects "never repeat a suggestion" over 5+ refinement turns; if not, have the backend inject a list of already-suggested titles.
- A/B the ~250-word cap: does a tighter cap hurt the reasoning section?
- Consider asking the model to end refinement turns with one question when feedback is ambiguous ("lighter how — funnier, or lower stakes?").
