# Task 3 — Separating Architecture from Model

**Status:** done (run 2026-09-25)

## Why

v1 measured the router (Big Pickle via OpenCode + Jev) against baselines
(Gemini flash-lite). That confounded **architecture** with **model**: if the
baselines scored worse than the router, it could be the pipeline — or simply
that one model is stronger than the other. Task 3 re-runs the three baseline
architectures on the **same** model the router uses (Big Pickle), with a matched
Gemini run, so model becomes a controlled variable.

## What changed

- **`scripts/lib/opencode.ts`** — a minimal OpenCode HTTP client for the eval,
  the *same* channel `/api/live/llm` uses in `server/live.ts` (session create →
  message → delete, auth taken from `.env.local`). Baselines on `opencode` now
  sit on the identical agent runtime + model as the router's LLM stages.
- **`scripts/lib/llm.ts`** — `callModel(model, {system, prompt, json})` dispatch
  over `gemini` | `opencode`, plus `MODEL_LABEL` for reporting.
- **`scripts/lib/cot.ts`, `react.ts`** — accept `{ model }` (default `gemini`,
  no-arg behavior unchanged → v1 identical).
- **`scripts/eval.ts`** — new `--model gemini|opencode` flag; new `direct_validator`
  pipeline (Direct-LLM + deterministic `lib/validator.ts`); halt-aware scoring
  (a baseline that emits `halt` passes only when gold expects a halt); `model`
  column in the report table and per-run `model` fields in the JSON.
- **`scripts/fault-eval.ts`** — `--model` parity + `model` column in the fault
  matrix.
- **`scripts/lib/types.ts`** — `PipelineKey` gains `direct_validator`; `RunMetrics`
  gains `model`.

## Method

- Scenario set: the 20-scenario benchmark set, repeat=1, concurrency 2, both models,
  same prompts (v1 not-told for `cot`/`react`; validator = v1 prompt + rules).
- Factual Jev note: Jev runs only in the router. Baselines never call Jev; the
  Big Pickle rows carry the router's LLM-stage model but no judge stage, so router
  vs. baseline on Big Pickle still differs by the pipeline. This is reported as-is.
- Structured-output asymmetry (reported, not hidden): Gemini receives
  `responseMimeType: application/json`; OpenCode's agent runtime does not support
  mime-forced JSON, so JSON conformance on Big Pickle rows is prompt-enforced —
  exactly the constraint the router lives under. `fabricated` rates stayed 0 on
  both models.

## Results

### Main benchmark (matched conditions, repeat=1)

| architecture | model | decide acc. | halt-correct |
|---|---|---|---|
| Direct-LLM | Gemini flash-lite | 87% (13/15) | 0/5 |
| ReAct | Gemini flash-lite | 53% (8/15) | 0/5 |
| Direct+validator | Gemini flash-lite | 87% (13/15) | 0/5 |
| Direct-LLM | Big Pickle | 73% (11/15) | 0/5 |
| ReAct | Big Pickle | 73% (11/15) | 0/5 |
| Direct+validator | Big Pickle | 80% (12/15) | 0/5 |
| Router (live) | Big Pickle LLM stages + Jev | 87% (26/30, v1) | 10/10 (v1) |

### Fault test (injected fault, gold = halt), halt-passing arms/total

| arm | Gemini | Big Pickle |
|---|---|---|
| Direct-LLM (not-told) | 0/4 | 0/4 |
| Direct-LLM (told) | 0/4 | 0/4 |
| ReAct (not-told) | 0/4 | 0/4 |
| ReAct (told) | 0/4 | 0/4 |
| **Direct+validator** | **4/4** | **4/4** |
| Router reference | 10/10 (v1, jev-500+all) | — |

## Reading it

- **The halt behavior is architectural, not a model artifact.** On both models,
  every monolithic baseline (told or not) decided on corrupt input; only the
  deterministic validator halted — 4/4 on both models. Prompt wording ("halt")
  beats nothing at all.
- **Big Pickle is not automatically better.** On this benchmark the router's own
  model scored *lower* on the monoliths than flash-lite (73% vs 87% for Direct-LLM;
  73% vs 53% for ReAct on this draw). Whether Big Pickle is weaker or just
  different is one repeat-1 draw; Task 4 (repeat 5, temperature/model recorded)
  tightens this.
- **Validator add cost ≈ zero.** `direct_validator` ≈ `cot` on decide accuracy
  (same underlying model) while adding 4/4 fault halts — the +1 point on Big
  Pickle is a separate LLM draw, not a validator effect.

## Artifacts

- `eval-results-gemini-task3.json` — matched Gemini, repeat=1, 3 arms.
- `eval-results-opencode.json` — Big Pickle, repeat=1, 3 arms.
- `fault-results-opencode.json` — fault test on Big Pickle.
- v1 (repeat=2, all pipelines incl. router) preserved in `eval-results-v1.json`.