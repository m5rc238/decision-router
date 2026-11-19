# Task 4 & `v2.1` Rigor Audit — Repeats, Paraphrases, Clustered Trials & Confusion Analysis

**Status:** audited offline under `grader-v2.0` (`v2.1`); repeat-5 baseline logs archived into [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json) and reproducible via `npm run replay`. Live Router v2 full-trace runs, clean un-throttled paraphrase runs, and 4 `requiresLiveModel` challenge cases remain **pending live execution**.

## Why (Task 4 goals + `v2.1` methodology fixes)

Task 3 gave a first model-controlled comparison at repeat=1. Task 4 added repeat=5 runs, temperature/model recording, paraphrase stimuli, and over-halt tracking. During the `v2.1` methodology audit, four important corrections were made to how those measurements are computed and interpreted:

1. **Clustered repeat-5 reporting instead of i.i.d. Wilson CIs:** `5` repeats of `15` scenarios (including near-duplicates `refund-30-days` and `edge-boundary-30-days`) are **clustered**, not 75 independent Bernoulli trials. Treating `65/75` as `n = 75` i.i.d. samples produces artificially narrow Wilson 95% confidence intervals (`scripts/lib/stats.ts` remains in the repo as a legacy utility). `v2.1` reports **unique-scenario `5/5` consistency alongside run totals, 4×4 outcome confusion matrices, and illustrative asymmetric error costs**.
2. **Gemini default temperature `0.7 → 0`:** Historical `eval-results-gemini-rep5.json` recorded `temperature: 0.7`. For deterministic policy evaluation, `scripts/lib/gemini.ts` now defaults to **`temperature: 0`** (overridable via `GEMINI_TEMPERATURE`).
3. **Un-injected `eval.ts` fault rows labeled honestly:** `scripts/eval.ts` runs (`v1`, `Task 3`, `rep5`) never injected fault payloads into baseline evidence channels. Rather than counting those rows as baseline "missed faults", `replay.ts` separates them as **`not injected (20)`** per `rep5` arm (`N/A`); real fault handling is measured via `fault-results*.json` and `scripts/lib/challenge.ts`.
4. **`eval-results-gemini-variations.json` 429 error-masking post-mortem:** In the historical `--variations` Gemini paraphrase run (`186` runs), all **`62/62` `direct_validator` runs failed with HTTP `429` quota throttling**, yet **`5/5` `gold = halt` runs were scored `PASS` (`100%`)** in v1 because `eval.ts` ignored `r.error` and `validator` turned `decision: null` into `halt / decision_not_extracted`. `grader-v2.0` (`verdictForOutcome`) and `validator-v2.1` now reject any run carrying an upstream `serviceError` (`unrelated_service_error`), dropping that false `5/5` to `0/5`.

## What changed (Task 4 + `v2.1`)

- `scripts/lib/gemini.ts` — explicit `temperature` (default `0` in `v2.1`, was `0.7` during historical `rep5`) and `modelVersion` recorded per run.
- `scripts/lib/opencode.ts` / `scripts/lib/llm.ts` — records `modelID` (`big-pickle`); exposes `temperature: undefined` (OpenCode agent runtime has no user-tunable sampling temperature) and documents non-comparable runtime-cached tokens (`tokensIn` spanned `2–20,948` in `eval-results-opencode-rep5.json`).
- `scripts/lib/paraphrases.ts` — 3 rewordings per decidable/escalation scenario (`14` scenarios; facts byte-identical so gold matches base scenario). Note: historical `eval-results-gemini-variations.json` hit Gemini quota 429s across `direct_validator` and is **not** cited as clean empirical evidence; a fresh paraphrase run requires live API keys.
- `src/lib/live/gold.ts` (`grader-v2.0`) & `scripts/lib/validator.ts` (`v2.1`) — explicitly reject upstream `serviceError` (`unrelated_service_error`), separate common outcome verdicts from Router stage checks, distinguish valid `request_review` escalations from accidental stops/timeouts, and separate unnecessary stops from missed faults.
- `scripts/lib/replay.ts` & `scripts/replay.ts` — computes offline 4×4 confusion matrices (`approve_refund`, `deny_refund`, `escalate`, `stop_or_error`), unique-scenario consistency, `unnecessaryStops`, and illustrative asymmetric error costs (`wrongApproveRefund = 10`, `missedFault = 10`, `serviceError = 6`, `wrongDenyRefund = 4`, `unnecessaryEscalateOrStop = 1`).

## Methods / conventions

- Gold is always resolved from the base scenario id + facts via `goldScenarioFor()`, so any future un-throttled paraphrase `refund-10-days~p2` receives the identical policy gold as `refund-10-days`.
- Asymmetric error costs in `replay.ts` are explicitly **illustrative heuristic weights** (reflecting that wrong automated refunds and missed corrupt inputs cost more than conservative human escalation), not empirical accounting figures.
- Unnecessary stop rate covers `gold = decide` (approve/deny/escalate) runs where the system emitted `halt`/`stop_or_error` when a decision or valid escalation was required.

## Results (Offline audit of `rep5`, `N = 600` baseline runs)

Recomputed deterministically by `npm run replay` from [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json):

### A. Summary table (15 decide scenarios × 5 repeats = 75 decide runs; 20 fault scenarios not injected in `eval.ts`)

| Model | Architecture | Unique scenarios 5/5 | Decide runs (`n=75`) | Shared faults in `eval.ts` | Unnec. stops | Cost/run\* | Mean latency | Mean tokens |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| — | `rules_only` (`0` AI) | **13/15 (`86.7%`)** | deterministic | `4/4` (`fault-results` set) | `0` | 1.33 (ref) | `<1 ms` | `0` |
| Gemini flash-lite (`T=0.7` hist.) | `cot` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | `0` | 1.33 | 2,767 ms | 527 |
| Gemini flash-lite (`T=0.7` hist.) | `direct_validator` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | `0` | 1.33 | 2,214 ms | 527 |
| Gemini flash-lite (`T=0.7` hist.) | `react` | 6/15 (`40.0%`) | 51/75 (`68.0%`) | `not injected (20)` | `0` | **0.76** | 3,687 ms | 840 |
| Big Pickle (OpenCode) | `cot` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | `0` | 1.33 | 1,728 ms | 502 (non-comp.) |
| Big Pickle (OpenCode) | `direct_validator` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | `0` | 1.33 | 1,966 ms | 68 (non-comp.) |
| Big Pickle (OpenCode) | `react` | 11/15 (`73.3%`) | 64/75 (`85.3%`) | `not injected (20)` | `0` | 0.99 | 3,742 ms | 203 (non-comp.) |

### B. 4×4 Confusion breakdown on the `rep5` decide scenarios (`n = 75` per arm)

Each row shows observed outcomes across `20` `gold=approve_refund`, `25` `gold=deny_refund`, and `30` `gold=escalate` trials:

- **`cot` & `direct_validator` (Gemini & Big Pickle, identical confusion across all 4 cells):**
  - `gold = approve_refund` (`n=20`): **20** `approve_refund`
  - `gold = deny_refund` (`n=25`): **25** `deny_refund`
  - `gold = escalate` (`n=30`): **20** `escalate`, **10** `approve_refund` (`ambiguous-plan` + `edge-conflicting-claims`, `10` pts each → illustrative cost **`1.33`/run**)
- **Gemini `react`:**
  - `gold = approve_refund` (`n=20`): **16** `approve_refund`, **4** `escalate` (over-escalations, `1` pt each)
  - `gold = deny_refund` (`n=25`): **24** `deny_refund`, **1** `escalate` (`1` pt)
  - `gold = escalate` (`n=30`): **23** `escalate`, **2** `approve_refund` (`10` pts each), **5** `deny_refund` (`4` pts each → total `57` pts, **`0.76`/run**)
- **Big Pickle `react`:**
  - `gold = approve_refund` (`n=20`): **17** `approve_refund`, **3** `escalate` (`1` pt each)
  - `gold = deny_refund` (`n=25`): **24** `deny_refund`, **1** `escalate` (`1` pt)
  - `gold = escalate` (`n=30`): **23** `escalate`, **7** `approve_refund` (`10` pts each → total `74` pts, **`0.99`/run**)

### C. Pending live work (requires `.env.local` API keys)

- Fresh `--variations` paraphrase robustness run without Gemini `429` throttling.
- Full 8-stage Router v2 live run preserving `stages[]`, `runStatus`, `haltStage`, and `haltCode`.
- Live evaluation of the 4 `requiresLiveModel` challenge/judgment cases (`chal-customer-contradicts-timeline`, `chal-customer-contradicts-status`, `chal-judgment-outage-exception`, `chal-judgment-legal-threat-first-refund`).

## Artifacts

- Committed sanitized replay bundle: [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json) (`npm run replay`)
- Paraphrase fixtures & legacy CI utility: `scripts/lib/paraphrases.ts`, `scripts/lib/stats.ts`
- Archived gitignored source logs represented in bundle: `eval-results-opencode-rep5.json`, `eval-results-gemini-rep5.json`; invalid/throttled `eval-results-gemini-variations.json` excluded from empirical claims.
