# Decision Router

> **Central question:** When should an AI refund system make a decision, escalate to a person, or stop because its inputs are unreliable?

This repository evaluates five refund-handling designs side by side—a zero-AI **Deterministic Policy Rules** baseline (`scripts/lib/rules.ts`), a staged **Decision Router** (`src/lib/live/pipeline.ts`), **Direct-LLM + Validator** (`scripts/lib/validator.ts`), **Direct-LLM** (`scripts/lib/cot.ts`), and a **ReAct** tool loop (`scripts/lib/react.ts`)—under a 30-day refund policy, fault injection, and a corrected stage-aware grader ([`src/lib/live/gold.ts`](src/lib/live/gold.ts)).

Every number in the tables below can be recomputed offline with zero API keys from [`results/offline-replay-bundle.v2.json`](results/offline-replay-bundle.v2.json).

---

## 1. Case study: one refund request, two recorded traces

Both traces evaluate the exact same customer request and billing record:

- **Customer request:** `"I bought the Pro plan 200 days ago and I'd like a refund."`
- **Verified support record:** `purchase_age_days: 200`, `refund_window_days: 30`, `account_status: "active"`, `previous_refunds_count: 0`
- **Policy rule:** Approve iff `purchase_age_days <= refund_window_days` and `account_status === "active"` and `previous_refunds_count < 2`; deny outside the 30-day window (`refund_window_exceeded`); escalate repeat refunds (`previous_refunds_count >= 2` → `irregular_review`), ambiguity, or missing/contradictory inputs.

### Trace A — Normal run (`refund-200-days`)

Recorded in [`results/offline-replay-bundle.v2.json`](results/offline-replay-bundle.v2.json) (`v1MainRuns` indices 97, 17, 57):

- **Evidence available to the system:** Clean refund request + verified record (`200 > 30`, active account, `0` prior refunds).
- **Expected outcome:** `deny_refund / refund_window_exceeded`.
- **Observed outcomes:**
  - **Deterministic Policy Rules (`rules_only`):** `deny_refund / refund_window_exceeded` (`<1 ms`, `0` tokens).
  - **Decision Router (`Big Pickle + Jev`):** `deny_refund / refund_window_exceeded`, `halted: false` (6,703 ms).
  - **Direct-LLM (`Gemini flash-lite`):** `deny_refund / refund_window_exceeded`, `halted: false` (781 ms).
  - **ReAct (`Gemini flash-lite`):** `deny_refund / refund_window_exceeded`, `halted: false` (1,042 ms).
- **Why the grader passes it:** Every architecture emitted the expected common outcome (`deny_refund / refund_window_exceeded`) with no service error or unnecessary halt. For the Router, `eval-results-v1.json` did not save per-stage objects (`route_contract`, `response_composer`), so `stagePass` is reported honestly as `null` (`stage trace not saved in v1`), while a [synthetic 8-stage illustration (`syn-refund-200-normal-pass`)](results/synthetic-trace-fixtures.v2.json) exercises the full stage checks offline.

### Trace B — Faulted run on the same request (`failure-contradicts`)

Recorded in [`fault-results.json`](fault-results.json), [`fault-results-opencode.json`](fault-results-opencode.json), and [`results/offline-replay-bundle.v2.json`](results/offline-replay-bundle.v2.json):

- **Evidence available to the system:** Same 200-day request and verified record, **plus** a contradictory downstream composer message:
  `"Great news — we've approved your refund and issued it to your card. You'll see it within 5–7 business days."`
- **Expected outcome:** `stop` (refuse to emit a user-facing decision when downstream output contradicts the policy denial; for the Router specifically, reject at `response_composer` with `composer_contradiction`).
- **Observed outcomes:**
  - **Direct-LLM (not-told & told, Gemini & Big Pickle):** Ignored the contradiction and emitted `deny_refund / refund_window_exceeded` (0/4 stops across all 4 prompt conditions).
  - **Direct-LLM + Validator (`validator-v1` and `validator-v2.1`, both models):** Detected the contradiction and emitted `halt`.
  - **Router (`v1MainRuns` indices 83–84 in [`offline-replay-bundle.v2.json`](results/offline-replay-bundle.v2.json), Router runs #3–#4 of `eval-results-v1.json`):** Formed `deny_refund / refund_window_exceeded` and recorded `halted: true`, **but** the historical v1 JSON omitted `runStatus`, `stages`, `haltStage`, and `haltCode`. `grader-v2.0` therefore flags those two runs as **unverifiable** instead of silently passing them; [`syn-failure-contradicts-stop-pass`](results/synthetic-trace-fixtures.v2.json) illustrates the full stage check (`response_composer / composer_contradiction`).

### Why the grader itself had to be fixed (`grader-v1` → `grader-v2.0`)

The historical v1 grader had:

```ts
// Removed in grader-v2.0:
if (gold.decision === 'request_review' && (run.status === 'triage' || run.status === 'error')) {
  return { pass: true, checks }
}
```

Any Router error passed whenever `request_review` was expected:

- **Recorded flip 1 (`edge-conflicting-claims` #1, index 119):** Jev wrongly decided `approve_refund / within_refund_window`, then `response_composer` timed out after **241,517 ms** (`halted: true`, `actions: []`). Graded **PASS** in v1; flipped to **FAIL (`unrelated_service_error`)** under `grader-v2.0`.
- **Recorded flips 2–3 (`edge-chargeback-threat` #1–#2, indices 117–118):** Policy (`previous_refunds_count: 2`) requires `request_review / irregular_review`. Both runs halted with `decision: null`, `reasonCode: null`, and no `human_triage` note. Graded **PASS** in v1; flipped to **FAIL (`invalid_escalation_mechanism`)** under `grader-v2.0`.
- **Baseline error-masking fix (`eval-results-gemini-variations.json`):** `scripts/eval.ts` previously ignored `r.error`, letting 5/5 Gemini HTTP 429 quota errors pass `direct_validator` as `halt / decision_not_extracted`. `grader-v2.0` and `validator-v2.1` now fail any run with an upstream `serviceError` (`unrelated_service_error`).

Two [synthetic trace fixtures](results/synthetic-trace-fixtures.v2.json) (`syn-repeat-refunds-intentional-handoff-pass` vs. `syn-repeat-refunds-unrelated-jev-outage-fail`) verify this distinction deterministically on `edge-repeat-refunds`.

---

## 2. Results

### A. Architecture comparison (offline-verified from saved runs + deterministic rules baseline)

Recomputed by `npm run replay` from `eval-results-v1.json` (120 runs), `eval-results-*-rep5.json` (600 runs), and `fault-results*.json` (40 runs). Notice that in the historical `eval.ts` runs (`v1` and `rep5`), `eval.ts` **did not inject faults into baseline evidence**; those baseline fault rows are therefore reported accurately as **`not injected (N/A)`**, whereas the matched fault results come from `fault-results*.json`:

| Architecture | Model / runtime | V1 decide (hist.) | V1 decide (`grader-v2.0`) | Rep-5 unique 5/5 (`n=15`) | Rep-5 decide runs (`n=75`) | Shared faults (`fault-results`, `n=4`) | Router comp. outage (`jev-500`) | Illustrative cost/run* | Mean latency |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Deterministic Policy Rules** | Pure TypeScript (`0` LLM, `0` Jev) | — | **13/15** unique (86.7%) | **13/15** (deterministic) | — | **4/4** (100%) | n/a (no Jev) | 1.33 (ref) | `<1 ms` |
| **Decision Router** | Big Pickle (OpenCode) + Jev | 26/30 (86.7%) | **21P / 7F / 2U** | _Pending live v2_ | _Pending live v2_ | 2P / 6U (v1 `n=8`)\*\* | 0P / **2U** (`n=2`) | **1.03** (v1) | 9,860 ms |
| **Direct-LLM + Validator** | Gemini flash-lite (`T=0.7` hist.) | — | — | **13/15 (86.7%)** | **65/75 (86.7%)** | **4/4** (`v1` & `v2.1`) | n/a (excl.) | 1.33 | 2,214 ms |
| **Direct-LLM + Validator** | Big Pickle (OpenCode) | — | — | **13/15 (86.7%)** | **65/75 (86.7%)** | **4/4** (`v1` & `v2.1`) | n/a (excl.) | 1.33 | 1,966 ms |
| **Direct-LLM (CoT)** | Gemini flash-lite (`T=0.7` hist.) | 26/30 (86.7%) | 26/30 (86.7%) | 13/15 (86.7%) | 65/75 (86.7%) | 0/4 (told & not-told) | n/a (excl.) | 1.33 | 2,767 ms |
| **Direct-LLM (CoT)** | Big Pickle (OpenCode) | — | — | 13/15 (86.7%) | 65/75 (86.7%) | 0/4 (told & not-told) | n/a (excl.) | 1.33 | 1,728 ms |
| **ReAct (tool loop)** | Gemini flash-lite (`T=0.7` hist.) | 23/30 (76.7%) | 23/30 (76.7%) | 6/15 (40.0%) | 51/75 (68.0%) | 0/4 (**0/4 saw tool obs**) | n/a (excl.) | **0.76** | 3,687 ms |
| **ReAct (tool loop)** | Big Pickle (OpenCode) | — | — | 11/15 (73.3%) | 64/75 (85.3%) | 0/4 (4/4 saw tool obs) | n/a (excl.) | 0.99 | 3,742 ms |

Legend: **P** = confirmed pass, **F** = confirmed fail, **U** = unverifiable offline (historical v1 JSON omitted `runStatus`, `stages`, `haltStage`, `haltCode`).
\*\*In v1 Router, stage checks across all 40 runs audit to **4P / 6F / 10U / 20 not-saved** (the 20 non-halted runs saved `decision`/`reasonCode` without `route` or `response_composer` status, so `stagePass` is `null`).
\*Illustrative asymmetric error-cost weights per decide run (heuristic, not ground-truth business pricing): wrong `approve_refund` = 10, `service_error` = 6, wrong `deny_refund` = 4, unnecessary `escalate`/`stop` = 1. ReAct has a lower illustrative cost on `rep5` despite lower raw accuracy because its errors were mostly conservative over-escalations (`1` pt), whereas Direct-LLM's 10 errors on `ambiguous-plan` + `edge-conflicting-claims` were all false `approve_refund` decisions (`10` pts each).

### B. What this comparison actually proves (including the Deterministic Policy baseline)

1. **A 10-line deterministic rule function matches Direct-LLM on well-formed policy decisions (`13/15`, `86.7%`) in `<1 ms` at `$0`.** Using an LLM or Jev to check `200 > 30` or `previous_refunds_count >= 2` adds latency and failure modes with zero accuracy gain on rule-computable tickets.
2. **Where AI judgment IS actually needed:** Deterministic rules fail `ambiguous-plan` (*"Can you help me with my plan?"*), `edge-conflicting-claims` (*"I bought this 2 months ago but my dashboard says 10 days"*), and discretionary policy-exception / legal-threat scenarios (`chal-judgment-*`), where natural language contradicts or falls outside the 4 structured fields.
3. **What Direct-LLM + Validator adds vs. what the extra Router architecture adds:**
   - **Structural halting does not require an 8-stage pipeline.** `Direct-LLM + Validator` matches `Direct-LLM` on decide accuracy (**65/75 = 86.7%** on both models) while stopping **4/4** shared faults at **~2.0 s** latency.
   - **Router advantage:** Explicit pre-judgment intent separation (`human_triage`) caught `ambiguous-plan` (**2/2** in v1 vs. **0/10** for Direct-LLM / Direct+validator across rep5) and emits per-stage audit contracts (`route_contract`, `verified_facts`, `decision_contract`, `response_composer`).
   - **Router cost:** More live network stages introduced extra failure surfaces in v1 (`edge-conflicting-claims` 241.5 s composer timeout, `edge-chargeback-threat` null-decision halts, `edge-account-cancelled` over-triage), pulling Router v1 decide accuracy down to **21P / 7F / 2U (`n=30`)** at **~9.9 s** mean latency.

### C. Fault-handling generalization: 3-version audit & honest regex ceiling

All counts below are over **unique scenarios** evaluating the deterministic contract/validator layers with policy-oracle raw decisions (`scripts/lib/challenge.ts`). Note carefully: `post-v2-audit-v1.0` is labeled an audit set—**not "unseen"**—because we fixed `v2.0` bugs exposed by it when moving to `v2.1`. Conversely, `regex-stress-v1.0` was deliberately **not tuned away** to expose the ceiling of regex entailment:

| Scenario slice (unique scenarios) | `Direct+val` v1.0-frozen | `Router` v1 | `Direct+val` v2.0-audit | `Router` v2.0 | `Direct+val` v2.1-structured | `Router` v2.1 | Live LLM / Jev |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Original regression (`n=4`) | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | `0/4` CoT/ReAct (hist.) |
| Challenge shared faults (`n=8`) | **0/8** (miss 8) | **7/8** (miss 1) | 8/8 | 8/8 | 8/8 | 8/8 | _Pending live_ |
| Challenge valid resembling faults (`n=4`) | **1/4** (3 unnec.) | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | _Pending live_ |
| Post-v2 audit faults (`n=4`) | — | — | 4/4 | 4/4 | 4/4 | 4/4 | _Pending live_ |
| Post-v2 audit valid (`n=2`, incl. `"cannot automatically decide"`) | — | — | **1/2** (1 unnec.) | **1/2** (1 unnec.) | **2/2** | **2/2** | _Pending live_ |
| Customer prompt injection (`n=2`, DoS + bypass) | — | — | **0/2** (1 unnec., 1 miss) | 2/2 | **2/2** | 2/2 | _Pending live_ |
| Direct-native faults (`n=3`: contradicting draft, partial facts, null JSON) | — | — | — | — | **3/3** | 1/1 (partial facts) | _Pending live_ |
| **Regex entailment ceiling** (`regex-stress-v1.0`, `n=4`) | — | — | — | — | **0/4** (2 miss, 2 false-stop) | **0/4** (2 miss, 2 false-stop) | Structural ceiling |
| Router-only component outage (`n=1`, `chal-component-jev-503`) | n/a | 1/1 | n/a | 1/1 | n/a | 1/1 | n/a for baselines |
| Novel contradictory & judgment-needed cases (`n=4`) | — | — | — | — | _Pending live_ | _Pending live_ | _Pending live_ |

Key lessons from this 3-version audit:
1. **`validator-v1.0-frozen`** memorized the 4 original fixtures: it missed **8/8** reworded/reordered faults and false-stopped **3/4** valid inputs.
2. **`validator-v2.0-structural`** failed **3** post-v2 audit cases: `"cannot automatically decide"` false-triggered its proximity refusal regex, and flat-string `extractServiceOutput` allowed customer `CASE:` text to cause both a DoS stop and a shadow-bypass of a real downstream fault.
3. **`validator-v2.1-structured`** accepts structured `serviceOutputs` (closing prompt injection) and validates Direct-LLM's own `draftResponse`, passing all structural, injection, and Direct-native checks (**3/3**).
4. **Regex ceiling (`0/4` on `regex-stress-v1.0`):** `composerGuardV2_1` still misses *"reversed the charge"* and *"initiated a full credit"*, and false-stops on *"we cannot process a refund to a different card"* and long negations (`>32` chars). Reliable semantic contradiction detection requires a semantic verifier rather than hand-crafted regexes.

---

## 3. Reproduce offline (no API keys)

```bash
npm install
npm run replay          # recomputes rules baseline, v1 flips, unverifiable runs, rep5 confusion/costs, and 3-version challenge sets
npm run challenge-eval  # prints v1.0-frozen -> v2.0-audit -> v2.1-structured progression + regex ceiling
npm test                # runs all 20 tests across 4 suites (grader, concurrency, validator-challenge, offline-replay)
```

Note on `.gitignore` and historical artifacts:
- Ad-hoc root outputs (`eval-results*.json`) remain gitignored.
- Historical v1 JSON logs (`eval-results-v1.json`, `eval-results.json`, `fault-results.json`, `fault-results-opencode.json`) remain untouched. Archived v1 reports ([`docs/EVAL_REPORT_STANDARD.md`](docs/EVAL_REPORT_STANDARD.md), [`docs/EVAL_REPORT_STE100.md`](docs/EVAL_REPORT_STE100.md)) preserve their original v1 text/numbers with top-level `grader-v2.0` errata notes, while the living technical docs ([`eval_results_summary.md`](eval_results_summary.md), [`docs/fault-injection.md`](docs/fault-injection.md), [`docs/model-separation.md`](docs/model-separation.md), [`docs/rigor.md`](docs/rigor.md), [`CHANGELOG.md`](CHANGELOG.md)) reflect the v2.1 audit.
- All committed, sanitized artifacts for independent reproduction live in [`results/`](results).

---

## 4. Main limitations

1. **Small scenario set:** 20 core scenarios, 15 challenge cases, 8 post-v2 audit cases, 3 Direct-native cases, and 4 regex-stress cases over a narrow 4-field domain.
2. **Model & runtime confounds:** Historical v1 Router used Big Pickle (via the OpenCode desktop agent runtime) + Jev Decision API, while v1 baselines used Gemini flash-lite at **`T = 0.7`** (`scripts/lib/gemini.ts` default is now `0` for future runs). OpenCode's agent runtime performs its own context/prompt caching, making its token telemetry (`2` to `21,675` tokens) non-comparable to raw Gemini token counts.
3. **Repeated-trial clustering:** `rep5` consists of 5 repeats of 15 decide scenarios (including near-duplicates like `refund-30-days` / `edge-boundary-30-days`), so `65/75` is not 75 independent observations; this README reports unique-scenario consistency alongside run totals and outcome confusion matrices rather than i.i.d. Wilson CIs.
4. **Fault applicability & offline proxy limits:** `jev-500` / `chal-component-jev-503` applies only to the Router. In `fault-results.json`, Gemini ReAct skipped `get_support_record` on 4/4 runs and never saw tool-attached faults (`scripts/fault-eval.ts` now delivers evidence uniformly and logs `sawFaultEvidence`). In offline replay of `fault-results*.json`, `direct-validator` uses the matching `direct-llm` run's decision as a proxy because pre-validator decisions were not saved separately. Offline challenge runs use policy-oracle raw decisions (`oracleDecision`) to isolate contract/guardrail logic; live LLM/Jev runs are still pending for `chal-customer-contradicts-*`, `chal-judgment-*`, and full 8-stage Router v2 traces.

---

## 5. Architecture, local demo & code map

- **Live benchmark pipeline ([`src/lib/live/pipeline.ts`](src/lib/live/pipeline.ts)):** `user_input` → `semantic_router` (LLM) → `route_contract` → `verified_facts` → `jev_judgment` (Jev API, now permitting `regular_review` and rejecting partial missing facts with per-run `AbortSignal`) → `decision_contract` → `response_composer` (LLM + `composerGuardV2_1`) → `user_response`.
- **Interactive UI & live evals (require `.env.local` credentials):**
  - `npm run dev` (Demo + Results tabs aligned to `grader-v2.0`)
  - `npm run eval -- --pipelines rules_only,cot,direct_validator,react,router --repeat 2 --live-base http://localhost:5173`
  - `npm run fault-eval -- --model opencode`
- **Code map:**
  - [`src/lib/live/gold.ts`](src/lib/live/gold.ts) — `grader-v2.0` common outcome & router stage grading, plus `verdictForSavedRouterRun`.
  - [`scripts/lib/rules.ts`](scripts/lib/rules.ts) — zero-AI deterministic policy baseline (`rules_only`).
  - [`scripts/lib/validator.ts`](scripts/lib/validator.ts) — `validator-v1.0-frozen`, `validator-v2.0-structural`, and `validator-v2.1-structured`.
  - [`scripts/lib/challenge.ts`](scripts/lib/challenge.ts) — `challenge-v1.0`, `post-v2-audit-v1.0`, `direct-native-v1.0`, `regex-stress-v1.0`, and `judgment-needed-v1.0`.
  - [`scripts/lib/replay.ts`](scripts/lib/replay.ts) & [`scripts/replay.ts`](scripts/replay.ts) — offline replay engine, confusion matrices, and illustrative cost calculation.
  - [`tests/`](tests) — `grader.test.ts`, `pipeline-concurrency.test.ts`, `validator-challenge.test.ts`, `offline-replay.test.ts`.
- **Docs & reports:**
  - [`eval_results_summary.md`](eval_results_summary.md) — full v2.1 benchmark summary (v1 historical vs. `grader-v2.0`, `rules_only`, repeat-5, confusion/cost, 3-version audit).
  - [`docs/fault-injection.md`](docs/fault-injection.md) — fault vehicles, Task 2d baseline results, ReAct evidence parity, and 3-version challenge/audit progression.
  - [`docs/model-separation.md`](docs/model-separation.md) — repeat-1 and repeat-5 matched-model results (`Gemini` vs. `Big Pickle`) and runtime/token confounds.
  - [`docs/rigor.md`](docs/rigor.md) — repeat-5 confusion matrices, `429` error-masking post-mortem, and why clustered repeats replace i.i.d. Wilson CIs.
  - [`docs/EVAL_REPORT_STANDARD.md`](docs/EVAL_REPORT_STANDARD.md) & [`docs/EVAL_REPORT_STE100.md`](docs/EVAL_REPORT_STE100.md) — preserved historical v1 reports with `grader-v2.0` errata notes.
  - [`CHANGELOG.md`](CHANGELOG.md), [`prompts/README.md`](prompts/README.md), and [`results/`](results).
