# Task 4 — Tighter instrumentation: repeats, paraphrases, CIs, over-halt

**Status:** code done; results being generated (repeat=5 runs in flight, 2026-09-25).

## Why

Task 3 gave a first model-controlled comparison at repeat=1. Task 4 raises the
rigor so the final numbers have meaningful error bars and wording is not a hidden
variable:

1. **Repeat 2 → 5** per scenario (preprint-grade point estimates).
2. **Per-run temperature + model version recorded** so every number is
   reproducible and no run silently mixes model versions.
3. **Paraphrase robustness set** (`scripts/lib/paraphrases.ts`): the same case,
   reworded 3 natural ways, same gold. A decision that flips when the customer
   rephrases is a weakness no accuracy score shows.
4. **95% Wilson score intervals** on decision accuracy (adds
   `wilson95`/`fmtWilson` in `scripts/lib/stats.ts`).
5. **Per-scenario table** so we can see *which* cases each architecture gets
   right, not just an average.
6. **Over-halt rate**: gold=decide runs where the arm withheld anyway and the
   gold reference did NOT accept it (router triage on request_review gold passes,
   so it is excluded; a failed-withhold on a decide case counts).

## What changed

- `scripts/lib/gemini.ts` — sends an explicit `temperature` (default 0.7, env
  `GEMINI_TEMPERATURE`) and reads `modelVersion` from the API response; both
  recorded per run.
- `scripts/lib/opencode.ts` / `llm.ts` — `modelVersion` is the reported
  `modelID` (big-pickle); temperature is exposed as `undefined` on the OpenCode
  agent runtime (no user-tunable sampling temperature) — reported honestly.
- `scripts/lib/cot.ts` / `react.ts` — results carry `modelVersion`/`temperature`.
- `scripts/lib/types.ts` — `RunMetrics` gains `modelVersion`, `temperature`.
- `scripts/lib/stats.ts` — `wilson95(k,n)` and `fmtWilson` (95% Wilson score
  interval).
- `scripts/lib/paraphrases.ts` — 3 rewordings per decidable/escalation scenario
  (14 scenarios; facts byte-identical so gold is identical). Fault scenarios are
  **excluded** (their gold is "halt"; rewording a fault fixture would change which
  error is tested). `expandWithParaphrases()` + `goldScenarioFor()` make gold
  resolve through the base scenario.
- `scripts/eval.ts` — `--variations` expands the set (ids `id`, `id~p1..p3`;
  `--ids` matches base ids), the report prints decision accuracy with 95% CI,
  an over-halt column, and a per-scenario table.

## Methods / conventions

- Gold is always resolved from the base scenario id + facts, so a paraphrase
  `refund-10-days~p2` gets the *same* gold as `refund-10-days`.
- Consistency (κ-style) is computed within a scenario id, so paraphrases are
  treated as distinct stimuli (that IS the point of the test).
- Over-halt denominator is gold=decide runs; a run counts only if it withheld
  (halted) and `pass === false`. Router triage on a request_review gold passes
  and is therefore not over-halt.

## Results

_Pending: data files `eval-results-opencode-rep5.json`,
`eval-results-gemini-rep5.json`._ The headline tables (model × arm × repeat=5,
fault matrix on both models, paraphrase flip table) are appended after the runs
complete.

## Artifacts

- `scripts/lib/paraphrases.ts`, `scripts/lib/stats.ts`
- `eval-results-opencode-rep5.json`, `eval-results-gemini-rep5.json`
- v1 / Task-3 files preserved.