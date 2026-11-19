# Decision Router — Benchmark Summary (`v2.1` + Historical v1)

**What this experiment is:** an evaluation of *authority routing* — **when should an AI refund system make a decision, escalate to a person, or stop because its inputs are unreliable?** It compares five architectures over a 30-day refund policy:

1. **Deterministic Policy Rules (`rules_only`):** pure TypeScript rule engine + structured validation (`0` LLM calls, `0` Jev calls, `<1 ms`).
2. **Decision Router (`router`):** 8-stage pipeline with typed contracts, verified facts, Jev Decision API judgment, and downstream composer guardrail (`src/lib/live/pipeline.ts`).
3. **Direct-LLM + Validator (`direct_validator`):** single structured LLM call followed by a deterministic validator (`scripts/lib/validator.ts`).
4. **Direct-LLM (`cot`):** single CoT JSON call (`scripts/lib/cot.ts`).
5. **ReAct (`react`):** tool-calling loop (`scripts/lib/react.ts`).

**Headline (`v2.1` offline audit under [`grader-v2.0`](src/lib/live/gold.ts)):**

- **Deterministic rules (`rules_only`) tie monolithic Direct-LLM on well-formed decisions (`13/15`, `86.7%`) and stop `4/4` shared faults at `<1 ms` and `$0` AI cost.** AI judgment is actually needed only where natural language contradicts or falls outside the 4 structured fields (`ambiguous-plan`, `edge-conflicting-claims`, and discretionary exception cases).
- **Structural halting does not require an 8-stage pipeline.** `Direct-LLM + Validator` matches `Direct-LLM` on decide accuracy (`65/75 = 86.7%` across `rep5` on both Gemini flash-lite and Big Pickle) while catching **4/4** matched shared faults at **~2.0 s** latency.
- **Re-scoring v1 under `grader-v2.0` (`results/offline-replay-bundle.v2.json`):** Removing the permissive rule that let any Router error pass on `request_review` flips **3** Router v1 decide runs from `PASS` to `FAIL` (**26/30 → 21P / 7F / 2U**) and flags all **10/10** historical Router halt runs as **unverifiable** (`runStatus`/`stages`/`haltStage`/`haltCode` were omitted in `eval-results-v1.json`). Meanwhile, v1/rep5 baseline fault rows had **no faults injected in `eval.ts`** (`not injected (N/A)`); matched fault comparisons (`0/4` CoT/ReAct vs `4/4` Direct+validator) come from `fault-results*.json`.

**Offline reproduction (zero API keys):**

```bash
npm run replay          # recomputes every table, confusion matrix, flip & challenge slice from results/
npm run challenge-eval  # runs the 3-version validator/guardrail audit + regex ceiling
npm test                # runs 20 unit/regression tests across 4 suites
```

- **Sanitized offline bundle:** [`results/offline-replay-bundle.v2.json`](./results/offline-replay-bundle.v2.json) (version `2.1.0`; archives saved runs from historical gitignored `eval-results-v1.json` / `eval-results.json`, `eval-results-*-rep5.json`, and `fault-results*.json`)
- **Synthetic 8-stage fixtures:** [`results/synthetic-trace-fixtures.v2.json`](./results/synthetic-trace-fixtures.v2.json) (`provenance: "synthetic_demonstration_fixture"` — illustrates full `LiveRun` stage grading offline)
- **Detailed docs:** [`README.md`](./README.md), [`docs/fault-injection.md`](./docs/fault-injection.md), [`docs/model-separation.md`](./docs/model-separation.md), [`docs/rigor.md`](./docs/rigor.md), [`docs/EVAL_REPORT_STANDARD.md`](./docs/EVAL_REPORT_STANDARD.md), [`docs/EVAL_REPORT_STE100.md`](./docs/EVAL_REPORT_STE100.md), [`CHANGELOG.md`](./CHANGELOG.md)

---

## 1. Historical v1 (`N = 120`) vs. `grader-v2.0` Re-score + `rules_only`

Recomputed by `npm run replay` from the 20 core scenarios × 2 repeats = 40 runs per live architecture (`N = 120`, archived from `eval-results-v1.json`), alongside the deterministic zero-AI `rules_only` baseline:

| Architecture | Model / runtime | Hist. v1 decide | `grader-v2.0` decide (`n=30` / unique `n=15`) | Shared faults (`n=8` or matched `n=4`) | Router outage (`jev-500`, `n=2`) | Router stage checks | Cost/decide run\* | Mean latency |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Deterministic Rules (`rules_only`)** | Pure TS (`0` LLM, `0` Jev) | — | **13/15** unique (`86.7%`) | **4/4** (`fault-results` shared) | n/a (no Jev) | n/a | 1.33 (ref) | `<1 ms` |
| **Decision Router (`router`)** | Big Pickle (OpenCode) + Jev | 26/30 (`86.7%`) | **21P / 7F / 2U** | **2P / 0F / 6U** (`n=8`) | 0P / **2U** | **4P / 6F / 10U / 20ns** | **1.03** | 9,860 ms |
| **Direct-LLM (`cot`)** | Gemini flash-lite (v1) | 26/30 (`86.7%`) | 26P / 4F / 0U | `not injected (N/A; 8)` | n/a (excl. 2) | n/a (outcome only) | 1.33 | 2,096 ms |
| **ReAct (`react`)** | Gemini flash-lite (v1) | 23/30 (`76.7%`) | 23P / 7F / 0U | `not injected (N/A; 8)` | n/a (excl. 2) | n/a (outcome only) | **0.73** | 4,045 ms |

Legend: **P** = confirmed pass, **F** = confirmed fail, **U** = unverifiable offline (missing `runStatus`/`stages`/`haltStage`/`haltCode`), **ns** = stage traces omitted on completed historical runs (`stagePass: null`).  
\*Illustrative asymmetric error-cost weights per decide run (heuristic weights, not empirical accounting): `wrongApproveRefund = 10`, `missedFault = 10`, `serviceError = 6`, `wrongDenyRefund = 4`, `unnecessaryEscalate/Stop = 1`.

### What changed when `grader-v2.0` audited the saved v1 Router runs

The historical v1 grader treated any `status === 'error'` run as passing whenever gold expected `request_review`:

1. **Three confirmed Router v1 verdict flips (`v1=PASS → v2=FAIL`):**
   - `router#117` & `router#118` (`edge-chargeback-threat`): policy requires `request_review / irregular_review` (`previous_refunds_count: 2`), yet both runs halted with `decision: null`, `reasonCode: null`, and no `human_triage` note (`invalid_escalation_mechanism`).
   - `router#119` (`edge-conflicting-claims`): Jev formed `approve_refund / within_refund_window`, then `response_composer` timed out after **241,517 ms** (`unrelated_service_error`).
2. **Remaining 4 confirmed Router decide fails + `2U`:**
   - `#102` (`refund-31-days`): `unrelated_service_error` (halted downstream after forming `deny_refund`);
   - `#111`–`#112` (`edge-account-cancelled`): `unnecessary_stop` (halted with `decision: null` instead of `deny_refund`);
   - `#120` (`edge-conflicting-claims`): `wrong_decision` (`approve_refund` instead of `escalate`);
   - `#91`–`#92` (`failure-missing-facts`, gold `escalate`): **2U** because they halted with `decision: null` and omitted stage traces.
3. **Ten unverifiable historical Router halt runs (`v1=10/10 → v2=2P / 8U` across fault/missing-facts halts):**
   - Only `failure-missing-route` (#93–#94) is verifiable offline (`2P`, valid `human_triage` route stop). The remaining **10** halt runs across `failure-contradicts` (2), `failure-invalid-decision` (2), `failure-invalid-json` (2), `failure-jev-down` (2), and `failure-missing-facts` (2) lack `runStatus`/`stages`/`haltStage`/`haltCode`, so whether they stopped for the expected reason vs. an accidental timeout cannot be verified offline.

---

## 2. Repeat-5 Matched-Model Baselines (`N = 600`) & Matched Fault Matrix (`N = 40`)

From archived `eval-results-gemini-rep5.json` (`T=0.7` historical) and `eval-results-opencode-rep5.json` (15 decide scenarios × 5 repeats = 75 runs per arm; `eval.ts` did not inject shared faults):

| Model | Architecture | Unique scenarios 5/5 (`n=15`) | Decide runs (`n=75`) | Shared faults in `eval.ts` | Shared faults (`fault-results*`, `n=4`) | Cost/decide run\* | Mean latency | Mean tokens\*\* |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Gemini flash-lite** | `cot` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | 0/4 (`told` & `not-told`) | 1.33 | 2,767 ms | 527 |
| **Gemini flash-lite** | `direct_validator` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | **4/4** (`v1` & `v2.1`) | 1.33 | 2,214 ms | 527 |
| **Gemini flash-lite** | `react` | 6/15 (`40.0%`) | 51/75 (`68.0%`) | `not injected (20)` | 0/4 (`0/4` saw obs) | **0.76** | 3,687 ms | 840 |
| **Big Pickle (OpenCode)** | `cot` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | 0/4 (`told` & `not-told`) | 1.33 | 1,728 ms | 502 |
| **Big Pickle (OpenCode)** | `direct_validator` | **13/15 (`86.7%`)** | **65/75 (`86.7%`)** | `not injected (20)` | **4/4** (`v1` & `v2.1`) | 1.33 | 1,966 ms | 68\*\* |
| **Big Pickle (OpenCode)** | `react` | 11/15 (`73.3%`) | 64/75 (`85.3%`) | `not injected (20)` | 0/4 (`4/4` saw obs) | 0.99 | 3,742 ms | 203\*\* |

\*\*OpenCode runs through an agent runtime with system context and prompt/session caching (`tokensIn` in `eval-results-opencode-rep5.json` spans `2` to `20,948`; total tokens across bundle OpenCode runs reach `22,132`); its token counts are non-comparable to raw Gemini API token counts.

**Confusion & asymmetric cost insight (`npm run replay`):**
- On `rep5`, both `cot` and `direct_validator` (on both models) got **20/20** `approve_refund` and **25/25** `deny_refund` right, and made all **10/10** errors by outputting **`approve_refund` on `escalate` scenarios** (`ambiguous-plan` + `edge-conflicting-claims`, `10` pts each = `1.33` cost/run).
- `ReAct` had lower raw accuracy (**68.0%** Gemini, **85.3%** Big Pickle) yet lower illustrative cost (`0.76` and `0.99`/run) because many of its errors were conservative over-escalations (`1` pt) rather than unauthorized approvals (`10` pts).

---

## 3. Fault-Handling Generalization: 3-Version Audit & Regex Ceiling

To test whether fault handling generalizes beyond the 4 original fixtures, validator versions were frozen and evaluated over **unique scenarios** with policy-oracle raw decisions (`scripts/lib/challenge.ts`, [`docs/fault-injection.md`](./docs/fault-injection.md)):

| Scenario slice (unique scenarios) | `v1.0-frozen` (`Direct+val` / `Router`) | `v2.0-audit` (`Direct+val` / `Router`) | `v2.1-structured` (`Direct+val` / `Router`) | Notes |
| --- | :---: | :---: | :---: | --- |
| Original regression (`n=4`) | `4/4` / `4/4` | `4/4` / `4/4` | `4/4` / `4/4` | Original `fault-eval` fixtures |
| `challenge-v1.0` shared faults (`n=8`) | **`0/8`** / **`7/8`** | `8/8` / `8/8` | `8/8` / `8/8` | `v1` missed reworded/syntactic faults |
| `challenge-v1.0` valid resembling faults (`n=4`) | **`1/4`** / `4/4` | `4/4` / `4/4` | `4/4` / `4/4` | `v1` had 3 false stops on quoted/valid JSON |
| `post-v2-audit-v1.0` faults (`n=4`) | — | `4/4` / `4/4` | `4/4` / `4/4` | Internal audit set (not unseen) |
| `post-v2-audit-v1.0` valid (`n=2`) | — | **`1/2`** / **`1/2`** | `2/2` / `2/2` | `v2.0` false-stopped on `"cannot automatically decide"` |
| `post-v2-audit-v1.0` prompt injection (`n=2`) | — | **`0/2`** / `2/2` | `2/2` / `2/2` | `v2.0` suffered `CASE:` DoS + shadow bypass |
| `direct-native-v1.0` (`n=3`: draft / partial / null JSON) | — | — | `3/3` / `1/1` applicable | Self-contradicting draft, partial missing facts |
| **`regex-stress-v1.0` ceiling (`n=4`)** | — | — | **`0/4`** / **`0/4`** | **Deliberately un-tuned:** 2 misses, 2 false stops |
| Component outage (`chal-component-jev-503`, `n=1`) | `n/a` / `1/1` | `n/a` / `1/1` | `n/a` / `1/1` | Router-only component failure |

Four live-model-dependent scenarios remain **pending live execution**: `chal-customer-contradicts-timeline`, `chal-customer-contradicts-status`, `chal-judgment-outage-exception`, and `chal-judgment-legal-threat-first-refund`.

---

## 4. What This Comparison Actually Proves

1. **Deterministic rules beat LLMs on rule-computable tickets:** 10 lines of TypeScript (`rules_only`) hit **13/15 (`86.7%`)** decide accuracy and **4/4** shared fault halts in `<1 ms`, exposing where calling an LLM or Jev on clean tabular facts adds latency and failure surfaces for zero gain.
2. **Where AI judgment belongs:** Cases where conversational text overrides or contradicts the 4 structured fields (`ambiguous-plan`, `edge-conflicting-claims`, outage exceptions, legal/compliance escalation).
3. **Router vs. Direct-LLM + Validator:**
   - **Direct+Validator** gives structural fail-closed halting (`4/4` shared faults, `3/3` Direct-native faults, closed prompt injection in `v2.1`) without adding 8 serial stages.
   - **Decision Router** adds explicit pre-judgment intent routing (`ambiguous-plan` caught `2/2` in v1 vs `0/10` on `rep5` Direct+validator) and per-stage audit contracts, at the cost of higher latency (~9.9 s) and additional failure surfaces (`edge-conflicting-claims` timeout, `edge-account-cancelled` over-triage).
4. **Structural limit of regex guards:** Even `v2.1` scores **0/4** on `regex-stress-v1.0` (*"reversed the charge"*, *"initiated a full credit"*, *"cannot process a refund to a different card"*, >32-char negations). Semantic entailment at high recall/precision cannot rely purely on hand-crafted regexes.

---

## 5. Audit & Engineering Fixes Landed in `v2.0`–`v2.1`

- **`grader-v2.0` (`src/lib/live/gold.ts`):** Removed the permissive `request_review` error pass; separates common observable outcome checks from Router stage checks; rejects any upstream `serviceError` (`unrelated_service_error`); unified `regular_review` alongside `irregular_review` in `REASON_ALLOWED` (`src/lib/live/pipeline.ts`); enforces `REQUIRED_FACT_KEYS` (`purchase_age_days`, `refund_window_days`, `account_status`) in Stage 3 (`facts_missing`) and `gold.ts`.
- **Prompt-injection & Direct-native defense (`scripts/lib/validator.ts`):** `validator-v2.1-structured` validates typed `serviceOutputs` (never scanning customer `CASE:` text) and checks Direct-LLM's own `draftResponse`.
- **Pipeline concurrency & Stage 1 error handling (`src/lib/live/pipeline.ts`):** Replaced global mutable `CURRENT.runId` cancellation with per-call `AbortSignal`; wrapped Stage 1 `callLlm` in `try/catch`.
- **Harness fairness & reproducibility (`scripts/fault-eval.ts`, `scripts/eval.ts`, `scripts/lib/gemini.ts`):** Rejects `r.error` (fixing Gemini `429` error masking where 5/5 throttled runs passed in `eval-results-gemini-variations.json`); adds `rules_only` baseline; sets default Gemini temperature `0.7 → 0` (`scripts/lib/gemini.ts`); delivers fault evidence uniformly (`deliverEvidenceInPrompt` + `sawFaultEvidence`) so ReAct cannot skip it.

---

## 6. Limitations & Pending Work

- **Scope:** Small scenario set (20 core + 15 challenge + 8 post-v2 audit + 3 Direct-native + 4 regex-stress + 2 judgment cases) over a 4-field domain; zero live payments or persistent databases.
- **Historical confounds:** V1 Router ran Big Pickle + Jev while v1 baselines ran Gemini `T=0.7`; OpenCode runtime caching distorts token totals; historical `rep5` consists of clustered repeats (`5 × 15`) rather than i.i.d. observations; offline replay of `fault-results*.json` proxies `direct-validator`'s raw decision from matching `direct-llm` runs because pre-validator outputs were not stored separately in v1.
- **Pending live runs (no API keys in this offline environment):**
  - Clean paraphrase robustness run without Gemini `429` throttling;
  - Full 8-stage `live` Router v2 benchmark saving complete stage traces;
  - Live evaluation of the 4 `requiresLiveModel` cases (`chal-customer-contradicts-*`, `chal-judgment-*`) and live `direct-validator` / `fault-eval` v2.1 runs.
