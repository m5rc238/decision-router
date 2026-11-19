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

### Main benchmark (matched conditions, repeat=1 — Task 3 historical)

> **Audit note:** `halt-correct: 0/5` in the Task 3 `eval.ts` runs below reflects **`not injected (N/A)`** (because `eval.ts` did not inject faults into baseline evidence), rather than missed injected faults. For injected faults see the fault matrix below and `docs/fault-injection.md`. Under `grader-v2.0`, the Router v1 reference re-scores to **21P / 7F / 2U** decide and **2P / 8U** on the 10 fault/missing-facts halt runs.

| architecture | model | decide acc. | `eval.ts` halt rows |
|---|---|---|---|
| Direct-LLM | Gemini flash-lite | 87% (13/15) | 0/5 (`not injected`) |
| ReAct | Gemini flash-lite | 53% (8/15) | 0/5 (`not injected`) |
| Direct+validator | Gemini flash-lite | 87% (13/15) | 0/5 (`not injected`) |
| Direct-LLM | Big Pickle | 73% (11/15) | 0/5 (`not injected`) |
| ReAct | Big Pickle | 73% (11/15) | 0/5 (`not injected`) |
| Direct+validator | Big Pickle | 80% (12/15) | 0/5 (`not injected`) |
| Router (live) | Big Pickle LLM stages + Jev | 87% hist. → **21P/7F/2U** (`grader-v2.0`) | 10/10 hist. → **2P / 8U** |

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

## Repeat-5 Follow-Up & `v2.1` Confound Audit (`N = 600` baseline runs + `rules_only`)

Archived in [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json) and recomputed offline by `npm run replay` (from the saved `eval-results-gemini-rep5.json` at historical `T=0.7` and `eval-results-opencode-rep5.json`; 15 decide scenarios × 5 repeats = 75 runs per arm, plus deterministic zero-AI `rules_only`):

| Architecture | Model / runtime | Unique `5/5` (`n=15`) | Decide runs (`n=75`) | Shared faults (`fault-results*`, `n=4`) | Illustrative cost/run\* | Mean latency | Mean tokens\*\* |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Deterministic Rules (`rules_only`)** | Pure TS (`0` LLM, `0` Jev) | **13/15 (`86.7%`)** | deterministic | **4/4** (`100%`) | 1.33 (ref) | `<1 ms` | `0` |
| **Direct-LLM (`cot`)** | Gemini flash-lite (`T=0.7` hist.) | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | 0/4 (`told` & `not-told`) | 1.33 | 2,767 ms | 527 |
| **Direct+Validator (`direct_validator`)** | Gemini flash-lite (`T=0.7` hist.) | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | **4/4** (`v1` & `v2.1`) | 1.33 | 2,214 ms | 527 |
| **ReAct (`react`)** | Gemini flash-lite (`T=0.7` hist.) | 6/15 (`40.0%`) | 51/75 (`68.0%`) | 0/4 (`0/4` saw tool obs) | **0.76** | 3,687 ms | 840 |
| **Direct-LLM (`cot`)** | Big Pickle (OpenCode) | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | 0/4 (`told` & `not-told`) | 1.33 | 1,728 ms | 502\*\* |
| **Direct+Validator (`direct_validator`)** | Big Pickle (OpenCode) | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | **4/4** (`v1` & `v2.1`) | 1.33 | 1,966 ms | 68\*\* |
| **ReAct (`react`)** | Big Pickle (OpenCode) | 11/15 (`73.3%`) | 64/75 (`85.3%`) | 0/4 (`4/4` saw tool obs) | 0.99 | 3,742 ms | 203\*\* |

\*Illustrative heuristic weights per decide run: `wrongApproveRefund=10`, `serviceError=6`, `wrongDenyRefund=4`, `unnecessaryEscalate/Stop=1`. `eval.ts` did not inject shared faults into `rep5` (`not injected (20)` across all 6 model×arm cells).  
\*\*`direct-validator` in offline fault replay uses the matching `direct-llm` run as a proxy raw outcome.

### Remaining confounds exposed in `v2.1` (still separating architecture from runtime/model)

1. **Repeat-1 draw noise disappeared at `repeat = 5`:** Whereas Big Pickle trailed Gemini `73%` vs `87%` on the single Task-3 repeat-1 draw, at `repeat = 5` both models scored **identical `13/15` unique (`65/75 = 86.7%`)** on `cot` and `direct_validator`, and Big Pickle outperformed Gemini on `react` (`64/75 = 85.3%` vs `51/75 = 68.0%`).
2. **Gemini ReAct skipped tool calls on fault inputs:** On `fault-results.json`, Gemini `react` & `react-told` observed `SERVICE OUTPUT` on **0/4** runs because it stopped without calling `get_support_record`, whereas Big Pickle `react` & `react-told` (`fault-results-opencode.json`) observed `SERVICE OUTPUT` on **4/4** runs and still failed `0/4`. `scripts/fault-eval.ts` now supports `deliverEvidenceInPrompt` so future ReAct runs cannot bypass evidence collection.
3. **OpenCode agent-runtime caching distorts token telemetry:** Big Pickle runs through OpenCode's agent runtime (session + system context + prompt caching), yielding `tokensIn` values from **2 to 20,948** in `eval-results-opencode-rep5.json` (`68` mean tokens on `direct_validator` vs `502` on `cot`). OpenCode token totals are **non-comparable** to raw Gemini API token counts.
4. **Sampling temperature mismatch (`T=0.7` vs `undefined` → `T=0`):** Historical `rep5` Gemini runs used `T=0.7`, whereas OpenCode exposes no user-tunable temperature. `scripts/lib/gemini.ts` now defaults to **`T = 0`** for deterministic policy evaluation in future runs.
5. **Rules baseline benchmark check:** Both models on `cot`/`direct_validator` match — and do not beat — a zero-LLM deterministic rule function (`13/15 = 86.7%`) on decidable structured facts; AI judgment only adds value on semantic/discretionary cases outside structured fields.

## Artifacts

- **Committed sanitized replay bundle (all tables above recomputable offline via `npm run replay`):** [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json)
- Local gitignored raw sources archived into that bundle: `eval-results-gemini-task3.json`, `eval-results-opencode.json`, `eval-results-gemini-rep5.json`, `eval-results-opencode-rep5.json`, `fault-results.json`, `fault-results-opencode.json`, and `eval-results-v1.json`.