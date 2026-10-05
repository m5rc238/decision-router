# CHANGELOG

All notable changes to the benchmark (code, prompts, data, methodology) are
tracked here. Methodology notes that change interpretation of numbers are
flagged so results never silently mean something different than the previous
run.

## [Task 3] Homogeneity on the Router's model — 2026-09-25 (branch: working-tree, uncommitted)

Separates ARCHITECTURE from MODEL: the baselines were systematically run on the
exact model the Router uses (Big Pickle via the local OpenCode agent server),
with a matched Gemini run at identical settings, so model is now a controlled
variable. See `docs/model-separation.md` for the full write-up + tables.

### New: OpenCode client + model dispatch
- `scripts/lib/opencode.ts`: minimal client over the SAME `/api/live/llm` channel
  (session → message → delete, auth from `.env.local`), so baselines sit on the
  identical agent runtime + model as the Router's LLM stages. JSON conformance on
  Big Pickle is prompt-enforced (OpenCode has no mime-forced structured output);
  this asymmetry is reported, not hidden (Gemini arm uses `responseMimeType`).
- `scripts/lib/llm.ts`: `callModel(model, {system, prompt, json})` over
  `gemini` | `opencode`, `MODEL_LABEL` for reports.
- `cot.ts` / `react.ts`: optional `{ model }` (default `gemini`, v1 unchanged).
- `scripts/lib/types.ts`: `PipelineKey` + `direct_validator`, `RunMetrics.model`.

### eval.ts: model flag + validator arm + halt-aware scoring
- `--model gemini|opencode`; new `direct_validator` pipeline (Direct-LLM +
  deterministic `lib/validator.ts`); a baseline emitting `halt` now passes only
  when gold expects halt; `model` column in tables + per-run in JSON.

### fault-eval.ts: model parity
- `--model` flag; `model` / `modelLabel` columns in runs + tables.

### Results (repeat=1, matched conditions, 20 scenarios)
- Main benchmark decide accuracy: Direct-LLM **Gemini 87%, Big Pickle 73%**;
  ReAct **Gemini 53%, Big Pickle 73%**; Direct+validator **Gemini 87%, Big
  Pickle 80%**; halt-correct 0/5 for every baseline on both models (main
  benchmark does not inject fault markers). Router reference: 87% decide, 10/10
  halt (v1, repeat=2).
- Fault test (injected fault, gold=halt): **Direct+validator 4/4 on BOTH models**;
  every other baseline 0/4 on both models, told or not. → The halt behavior is
  architectural, reproduced on the Router's own model; the halt clause changes
  nothing on either model.
- Key finding: Big Pickle is not automatically better — the monoliths scored
  *lower* than flash-lite on this draw (Direct-LLM 73% vs 87%; ReAct 73% vs 53%).
  One repeat-1 draw; Task 4 tightens this.

### Artifacts
- `eval-results-gemini-task3.json`, `eval-results-opencode.json`,
  `fault-results-opencode.json`; v1 preserved. `docs/model-separation.md`.

### Pending (not yet done in this branch)
- Full re-run of the main benchmark (routine + fault, Task 4), paraphrase set
  (Task 4), per-run model/temperature recording (Task 4), PREREGISTRATION
  (Task 5), `failures.md` (Task 6), UI/report wording cleanup (Tasks 7-8).

## [Task 2] Fault-test fairness — 2026-09-25 (branch: working-tree, uncommitted)

### Bug fix: consistency metric (`scripts/eval.ts`)
The κ-style consistency metric was computed by incrementing a counter by 1 per
*distinct* outcome key instead of accumulating the per-pair run counts, so the
maximum agreement per scenario could never exceed 1 → κ was always `1/repeat`
(flat 0.50 at repeat=2) regardless of actual agreement. Fixed to accumulate
`consistencyMap[p][key]`.

Recomputed from `eval-results-v1.json`: **Direct-LLM 1.00, ReAct 0.975, Router
1.00** (ReAct's single discordant scenario is `ambiguous-plan`). Documentation
tables updated from the stale 0.50 values. Note: `eval-results-v1.json` still
stores the old 0.5 computed values; the corrected numbers live in the docs and
will be re-emitted on the next full run.

### Prompts: versioned + told/not-told conditions (`prompts/`)
- New `prompts/` directory, one file per arm/condition, all byte-verified:
  - `direct-llm-v1.txt` (original, no halt clause)
  - `direct-llm-v2-told.txt` (v1 + appended halt clause, pure-addition diff)
  - `react-v1.txt` (original)
  - `react-v2-told.txt` (v1 + appended halt clause, pure-addition diff)
- `scripts/lib/prompts.ts` builds the system prompts; `not-told` output is
  programmatically verified byte-identical to the pre-Task-2 prompts; `told` is
  verified to be a line-subsequence superset (pure addition).
- Shared, word-for-word identical halt clause across arms.

### New: fault injection for baselines (`scripts/lib/faults.ts`)
- Delivers the SAME fault payloads the router fails on into each baseline's own
  evidence channel: `SERVICE OUTPUT` block (Direct-LLM, Direct+validator) and
  the `get_support_record` tool observation (ReAct).
- `jev-500` declared **not applicable** to baselines (excluded from scores):
  they have no Jev stage. Documented in `docs/fault-injection.md`.

### New: deterministic validator arm (`scripts/lib/validator.ts`)
- Direct+validator = Direct-LLM with the **original (not-told)** prompt followed
  by a deterministic, zero-LLM-call validator: schema → enum → required-facts →
  injected-fault-marker checks. Halts on any failure.

### New: baseline fault test runner (`scripts/fault-eval.ts`)
- `npm run fault-eval` runs the 5 fault scenarios across Direct-LLM, ReAct,
  Direct+validator under both prompt conditions (repeat where applicable, real
  Gemini calls) and emits `fault-results.json` plus the two Task-2d tables
  (not-told vs told), keeping the router's v1 halt results as reference row.
- `cot.ts` / `react.ts` gained optional `mode` + `injectFault` args; their
  no-arg v1 path is unchanged (eval harness compatible).

### Task-2d diagnostic result (fault-results.json, 2026-09-25)
- Gold for every fault scenario is halt; pass = arm emitted halt (repeat 1,
  model `gemini-flash-lite-latest`).
- **Not-told (v1 prompts): Direct-LLM 0/4, ReAct 0/4, Direct+validator 4/4.**
- **Told (v2 prompts, halt clause): Direct-LLM 0/4, ReAct 0/4.**
- Telling the baselines to halt did not change behavior (all runs emitted
  `deny_refund` on corrupt input); the deterministic validator halted on every
  fault with zero LLM calls. Router reference 10/10 (`eval-results-v1.json`).

### Docs
- New `docs/fault-injection.md`: fault set, applicability, injection vehicles,
  told/not-told definition, validator rules, scoring, and what the test does and
  does not claim.

### Pending (not yet done in this branch)
- Full re-run of the main benchmark (routine + fault).
- Paraphrased scenarios (Task 4), per-run model/temperature recording (Task 4),
  homogeneity on the router's model (Task 3), PREREGISTRATION (Task 5),
  `failures.md` (Task 6), UI/report wording cleanup (Tasks 7-8).