# CHANGELOG

All notable changes to the benchmark (code, prompts, data, methodology) are
tracked here. Methodology notes that change interpretation of numbers are
flagged so results never silently mean something different than the previous
run.

## [v2.1] Rigor Audit, Security Fixes, Rules Baseline & Docs Alignment

Addresses methodological blind spots, prompt-injection vulnerabilities, global mutable state bugs, dead code, and stale reporting exposed during the post-v2 audit:

### New zero-AI baseline (`scripts/lib/rules.ts`)
- Added `runDeterministicPolicy` (`rules_only` pipeline in `eval.ts`, `rules-only` arm in `fault-eval.ts`, and replay summary).
- Matches Direct-LLM (`13/15`, `86.7%`) on decidable scenarios and catches `4/4` shared faults in `<1 ms` with `$0` AI cost, isolating where semantic judgment is genuinely required (`ambiguous-plan`, `edge-conflicting-claims`, `judgment-needed-v1.0`).

### Validator hardening & 3-version audit (`scripts/lib/validator.ts`, `scripts/lib/challenge.ts`)
- Preserved `validator-v1.0-frozen` (`validateDirectModelV1`) and `validator-v2.0-structural` (`validateDirectModelV2_0`) alongside the new default **`validator-v2.1-structured`** (`validateDirectModelV2_1`).
- Closed customer `CASE:` prompt-injection DoS and shadow-bypass flaws exposed in `post-v2-audit-v1.0` (`0/2` on `v2.0` → `2/2` on `v2.1`) by validating structured `serviceOutputs` objects (legacy flat-string fallback scoped after `lastIndexOf('\nVERIFIED SUPPORT RECORD')`) and checking Direct-LLM's own `draftResponse`.
- Fixed the `denyMentionedV2` proximity-regex false positive on `"cannot automatically decide"` in `fresh-valid-review-handoff-prose` (`composerGuardV2_1`; `composerGuardV2_0` preserved for regression).
- Added `direct-native-v1.0` (`3/3` Direct+val, `1/1` applicable Router), deliberately un-tuned `regex-stress-v1.0` (`0/4` ceiling probe across both Direct+val and Router), and 2 live `judgment-needed-v1.0` cases.

### Concurrency, error-masking & fairness fixes
- `src/lib/live/pipeline.ts`: replaced global mutable `CURRENT.runId` cancellation with per-call `signal?: AbortSignal`; wrapped Stage 1 `callLlm` in `try/catch`; aligned `REASON_ALLOWED` to accept `regular_review` alongside `irregular_review` and enforced `REQUIRED_FACT_KEYS` (`purchase_age_days`, `refund_window_days`, `account_status`) in Stage 3 (`facts_missing`).
- `scripts/lib/gemini.ts`: changed default sampling `temperature` from `0.7` to `0` for deterministic policy evals.
- `scripts/eval.ts` & `scripts/fault-eval.ts`: fixed `r.error` masking (which had passed `5/5` Gemini HTTP `429` throttled runs in `eval-results-gemini-variations.json`), added `deliverEvidenceInPrompt` + `sawFaultEvidence` so ReAct cannot skip injected evidence (`0/4` in historical Gemini `fault-results.json`), and recorded `preValidatorDecision`.
- `scripts/lib/replay.ts` & `scripts/replay.ts`: added 4×4 outcome confusion matrices, unique-scenario `5/5` consistency, illustrative asymmetric error costs, honest `not injected (N/A)` labeling on historical `eval.ts` fault rows, `stagePass: null` on v1 completed Router runs without stage traces, and `usedProxyRawOutcome` disclosure for offline `fault-results*.json` replay.

### Dead-code cleanup, UI & documentation alignment
- Removed unused mock pipeline/adapter/component code (`src/lib/pipeline/`, `src/lib/adapters/`, `src/lib/deterministic/`, `src/data/mockData.ts`, unused dashboard components).
- Aligned React UI (`src/App.tsx` with `AbortController`, `BenchmarkMatrix.tsx`, `AuthorityBoundaries.tsx`, `BaselinePane.tsx`, `ResultsPage.tsx`).
- Updated `README.md`, `eval_results_summary.md`, `docs/fault-injection.md`, `docs/model-separation.md`, `docs/rigor.md`, and `prompts/README.md` to v2.1; added `grader-v2.0` errata notes and relative links to preserved historical v1 reports (`docs/EVAL_REPORT_STANDARD.md`, `docs/EVAL_REPORT_STE100.md`) while keeping historical JSON logs untouched.

## [v2.0] Stage-Aware Grader, Generalization Challenge Set & Offline Replay

- **`grader-v2.0` (`src/lib/live/gold.ts`):** removed the permissive `request_review` error pass, required explicit valid escalation mechanisms and expected stage/reason codes, failed `unrelated_service_error`, separated common outcome verdicts from Router stage checks, and added `verdictForSavedRouterRun`. Auditing `eval-results-v1.json` revealed **3** Router v1 verdict flips (`26/30` → `21P / 7F / 2U`) and **10** unverifiable Router halt runs lacking stage traces (`10/10` → `2P / 8U` across fault/missing-facts halts).
- **Challenge sets & offline bundle (`results/`):** published `results/offline-replay-bundle.v2.json` (`v2.1.0`), `results/synthetic-trace-fixtures.v2.json`, `results/challenge-eval-*.json`, `scripts/replay.ts` (`npm run replay`), `scripts/challenge-eval.ts` (`npm run challenge-eval`), and 20 automated tests in `tests/`.

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