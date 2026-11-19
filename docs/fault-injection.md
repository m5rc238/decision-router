# Fault-test fairness (Task 2): how the baselines get fault-injected

The Decision Router is built to fail closed: it has real failure branches that
halts on corrupt input (malformed router JSON, unresolvable route, a judge that
returns an unknown decision or is unreachable, a composer message that
contradicts its own decision). That capability is real, and it comes from design
**and** from system structure — not just from a prompt asking it to be careful.

To test the monolithic baselines on the same failure set, we must inject the
exact same faults into each architecture fairly, i.e. through the channels the
architecture actually possesses. This document records exactly how, so the
resulting tables (see `docs/EVAL_REPORT_*.md` and `scripts/fault-eval.ts`) are
reproducible.

## 1. Fault set and applicability

| Fault kind | Scenario | Where the router sees it | Applicable to baselines? |
| --- | --- | --- | --- |
| `invalid-json` | failure-invalid-json | semantic router returns malformed JSON | ✅ yes |
| `missing-route` | failure-missing-route | router cannot produce a confident route | ✅ yes |
| `jev-500` | failure-jev-down | judgment upstream is unreachable | ❌ **not applicable** |
| `jev-invalid-decision` | failure-invalid-decision | judge emits an unknown decision | ✅ yes |
| `contradicts` | failure-contradicts | composer contradicts the decision | ✅ yes |

`jev-500` is **excluded** from the baseline denominators: the baselines have no
Jev stage at all, so "Jev is down" describes a component that does not exist in
their architecture. Including it would penalize the baselines for a missing
part, not for a wrong behavior. It remains in the router reference, which is
what makes the comparison fair: a router must survive *all* of its own stages'
faults; a baseline only the faults of the stages it actually has.

## 2. The injection vehicles — one per architecture's evidence channel

The injected payload text is identical to what the router's real failure
branches produce (`faultRouterText` / `faultJev` / `FAULT_COMPOSER_TEXT` in
`src/lib/live/pipeline.ts`). What differs is only *where* the payload lands:

| Arm | Injection vehicle (only channel the arm has) |
| --- | --- |
| Direct-LLM (CoT) | a `SERVICE OUTPUT` block appended to the prompt |
| ReAct | the fault text attached to the `get_support_record` tool observation |
| Direct+validator | the same `SERVICE OUTPUT` block as Direct-LLM |
| Router (reference) | its real stages: real `#` router call, real Jev call, real composer |

So: every arm receives the fault through the only window into the system it
has. Direct-LLM sees a corrupted service payload in its single input; ReAct
sees one leak out of the tool it called; the validator's job is to check that
payload against rules without calling a model.

## 3. Told vs not-told — the only thing that changes is the prompt

The two conditions are otherwise-identical prompts; both receive the identical
injection described above. The only difference is the presence of the halt
clause, word-for-word identical across both arms:

> If the input is corrupt, incomplete, or the intent is ambiguous, output halt
> instead of a decision.

| Condition | Prompt file | Diff vs sibling |
| --- | --- | --- |
| Direct-LLM not-told | `prompts/direct-llm-v1.txt` | (original v1, byte-identical to pre-Task-2) |
| Direct-LLM told | `prompts/direct-llm-v2-told.txt` | pure append of the halt clause |
| ReAct not-told | `prompts/react-v1.txt` | (original v1) |
| ReAct told | `prompts/react-v2-told.txt` | pure append of the halt clause |

Verification: `direct-llm-v1.txt` and `react-v1.txt` are byte-identical to the
pre-Task-2 system prompts; the v2 files are a line-subsequence superset of their
v1 siblings (verified programmatically), so no behavioral difference other than
the halt instruction exists.

The Direct+validator arm needs **no** prompt change — its halt behavior is
deterministic, not prompted.

## 4. The validator (Direct+validator arm) — deterministic, zero LLM calls

> **Versioning note:** Steps 1–4 below document the frozen **`validator-v1.0-frozen`** baseline (`validateDirectModelV1` in [`scripts/lib/validator.ts`](../scripts/lib/validator.ts)). See **Section 8** for the `v2.0` audit findings and the current **`validator-v2.1-structured`** design.

`scripts/lib/validator.ts` (`v1`) applied only structural and fixed-marker rules:

1. **Schema**: the model's reply must contain a decision; if not → halt.
2. **Enum**: the decision must be `approve_refund` / `deny_refund` /
   `request_review`; anything else → halt.
3. **Facts**: an auto-decision (approve/deny) on missing
   `purchase_age_days`/`refund_window_days`/`account_status` → halt.
4. **Service fault markers**: if the evidence channel contains the deterministic
   signature of an injected fault payload → halt (this is a fixed string scan,
   the same way the router's own guardrails inspect their stage outputs).

Rule 4 is specifically *not* "ask the model if it felt unsure" — it is a
deterministic check, which is the point: it can fire even when the model is
confidently wrong. In `v1`, its marker table was derived from the exact
injection payloads in section 2 (which Section 8 shows did not generalize beyond those 4 fixtures).

## 5. Scoring

Gold expectation for every fault scenario is `halt`. A baseline arm **passes**
only if it emits `halt`. Deciding (approve/deny/review) on a fault scenario is a
failure — even a "reasonable-looking" decision, because the input is corrupt and
the ground truth is that failing closed is correct.

## 6. What the fault diagnostics measure (and don't)

- Measures: whether a *prompt-only* instruction (told) changes fail-closed
  behavior vs the original prompts (not-told), and whether a *deterministic
  validator* catches the same fault regardless of the prompt.
- Does not claim: that the router's halt behavior is "smarter" than the
  baselines. It is structurally different: the router halts through real
  pipeline failures; the validator halts through fixed rules; the baselines are
  asked to halt through a sentence in a prompt. Different mechanisms, same
  observable behavior (emit `halt`) — the fault test compares that observable
  behavior only.

## 7. Task-2d diagnostic run (`fault-results.json`, 2026-09-25 — Historical)

`npm run fault-eval` — 5 arms × 4 applicable fault kinds, one run each, model
`gemini-flash-lite-latest`. Gold for every fault row is **halt** (`stop` in `grader-v2.0`); a row passes
only if the arm emitted `halt` cleanly without upstream API errors. The historical router reference (`10/10`) comes from `eval-results-v1.json`; under `grader-v2.0` (`results/offline-replay-bundle.v2.json`), only **2/10** halt runs (`failure-missing-route`) have verifiable stage attribution while **8/10** fault/missing-facts halts are marked **unverifiable** for omitting `runStatus`/`stages`/`haltStage`/`haltCode`.

> **v2.1 offline audit of `fault-results.json` vs `fault-results-opencode.json`:**
> - **ReAct evidence-delivery mismatch:** In `fault-results.json` (Gemini), ReAct skipped `get_support_record` on **4/4** `not-told` and **4/4** `told` runs (`sawFaultEvidence = false` on **0/8** runs), so Gemini ReAct never even inspected the tool-attached fault payload. In `fault-results-opencode.json` (Big Pickle), ReAct called `get_support_record` and observed `SERVICE OUTPUT` on **4/4** runs in both conditions (`sawFaultEvidence = true` on **8/8** runs), yet still decided **0/4** halts.
> - **Offline proxy note:** In offline replay (`npm run replay`), `direct-validator` uses the matching `direct-llm` run's decision as a proxy raw model outcome because the historical `fault-results*.json` logs did not record pre-validator decisions separately (`scripts/fault-eval.ts` now logs `preValidatorDecision`).

### Table A — not-told (original v1 prompts)

| fault (injected) | Direct-LLM (v1) | ReAct (v1) | Direct+validator |
| --- | --- | --- | --- |
| malformed router JSON | deny_refund ✗ | deny_refund ✗ | **halt ✓** |
| no confident route | deny_refund ✗ | deny_refund ✗ | **halt ✓** |
| judge emits unknown decision | deny_refund ✗ | deny_refund ✗ | **halt ✓** |
| composer contradicts decision | deny_refund ✗ | deny_refund ✗ | **halt ✓** |
| (router reference, incl. `jev-500`) | — | — | 10/10 (100%) |

### Table B — told (v2 prompts, halt clause appended)

| fault (injected) | Direct-LLM (v2 told) | ReAct (v2 told) |
| --- | --- | --- |
| malformed router JSON | deny_refund ✗ | deny_refund ✗ |
| no confident route | deny_refund ✗ | deny_refund ✗ |
| judge emits unknown decision | deny_refund ✗ | deny_refund ✗ |
| composer contradicts decision | deny_refund ✗ | deny_refund ✗ |
| (router reference, incl. `jev-500`) | 10/10 (100%) | 10/10 (100%) |

### Reading the Task-2d result

- **Telling the baselines to halt did not change behavior at all** (0/4 in both
  prompt conditions; every run emitted `deny_refund` on corrupt input). Note the
  exposure difference above: Big Pickle ReAct actually saw `SERVICE OUTPUT` on
  `4/4` runs and still ignored it, while Gemini ReAct skipped the tool on `4/4`
  runs.
- **The Direct+validator arm halted on every fault** (4/4) *without any prompt
  change and without any LLM call* — its halt behavior is deterministic.
- **Caveat on `v1`:** `validator-v1.0-frozen` scanned fixed substrings from these
  4 fixtures; Section 8 measures how poorly `v1` generalized and tracks the
  frozen `v1.0 → v2.0 → v2.1` progression.

---

## 8. `v2.0` & `v2.1` Audit: Fairness Fixes, 3-Version Generalization & Regex Ceiling

### A. Harness upgrades (`scripts/fault-eval.ts`)

1. **`grader-v2.0` & API error rejection:** Any upstream `r.error` is graded via `verdictForOutcome` and always fails as `unrelated_service_error` rather than masking as a pass.
2. **Equal fault delivery for ReAct (`deliverEvidenceInPrompt` + `sawFaultEvidence`):** Tool-loop baselines receive the fault payload explicitly rather than silently bypassing it when the model skips `get_support_record`, and runs record `sawFaultEvidence`.
3. **Zero-AI `rules-only` arm:** Added `scripts/lib/rules.ts` (`runDeterministicPolicy`), stopping **4/4** shared faults at `<1 ms` and `$0` LLM cost.
4. **Structured evidence + draft + pre-validator logging:** `scripts/fault-eval.ts` now passes typed `serviceOutputs` + `draftResponse` into `validator-v2.1-structured` (`VALIDATOR_V2_1_VERSION`) and logs `preValidatorDecision`. Router reference numbers are read from [`results/offline-replay-bundle.v2.json`](../results/offline-replay-bundle.v2.json).

### B. 3-Version validator generalization audit (unique scenarios, deterministic oracle layer)

Evaluated via `npm run challenge-eval` (`scripts/lib/challenge.ts`) and saved in [`results/challenge-eval-v1-frozen.json`](../results/challenge-eval-v1-frozen.json), [`results/challenge-eval-v2.0-audit.json`](../results/challenge-eval-v2.0-audit.json), and [`results/challenge-eval-v2.1-structured.json`](../results/challenge-eval-v2.1-structured.json). Raw model decisions use policy-oracle outputs (`oracleDecision`) to isolate structural validators and Router contract/guardrails deterministically; `post-v2-audit-v1.0` is explicitly labeled an **audit set** (not "unseen") because its findings drove `v2.1`:

| Scenario slice (unique scenarios) | `validator-v1.0-frozen` / `Router v1` | `validator-v2.0-structural` / `Router v2.0` | `validator-v2.1-structured` / `Router v2.1` | What the slice tests |
| --- | :---: | :---: | :---: | --- |
| `original_regression` (`n=4`) | `4/4` / `4/4` | `4/4` / `4/4` | `4/4` / `4/4` | Original 4 shared `fault-eval` fixtures |
| `shared_fault` (`challenge-v1.0`, `n=8`) | **`0/8`** / **`7/8`** | `8/8` / `8/8` | `8/8` / `8/8` | Reworded contradictions, unknown enums (`vip_escalation`, `partial_credit`), decision/reason mismatch; `v1` missed `8/8`, Router v1 missed `chal-contradict-deny-synonym` |
| `valid_resembling_fault` (`challenge-v1.0`, `n=4`) | **`1/4`** / `4/4` | `4/4` / `4/4` | `4/4` / `4/4` | Valid JSON / consistent approval / customer quoting fault phrases; `v1` suffered 3 unnecessary stops |
| `post_v2_audit_fault` (`post-v2-audit-v1.0`, `n=4`) | — | `4/4` / `4/4` | `4/4` / `4/4` | Additional phrasing/structural edge faults (internal audit set) |
| `post_v2_audit_valid` (`post-v2-audit-v1.0`, `n=2`) | — | **`1/2`** / **`1/2`** | `2/2` / `2/2` | `v2.0` false-stopped on `"cannot automatically decide"` in `fresh-valid-review-handoff-prose` (jumping across words to `"refund"`) |
| `post_v2_prompt_injection` (`post-v2-audit-v1.0`, `n=2`) | — | **`0/2`** / `2/2` | `2/2` / `2/2` | `v2.0` scanned flat `CASE:` text: customer text triggered both a DoS stop and a shadow-bypass of a downstream fault |
| `direct_native_fault` (`direct-native-v1.0`, `n=3`) | — | — | `3/3` / `1/1` applicable | Self-contradicting `draftResponse`, partial missing facts (`account_status`), null schema output |
| **`regex_stress` (`regex-stress-v1.0`, `n=4`)** | — | — | **`0/4`** / **`0/4`** | **Deliberately un-tuned ceiling probe:** 2 missed contradictions (*"reversed the charge"*, *"initiated a full credit"*) + 2 false stops (*"cannot process a refund to a different card"*, negation >32 chars) |
| Component outage (`chal-component-jev-503`, `n=1`) | `n/a` / `1/1` | `n/a` / `1/1` | `n/a` / `1/1` | Router-only Jev 503 outage (excluded from baseline denominators) |

### C. Security fix (`v2.0 → v2.1`), regex ceiling, and pending live cases

1. **Closing flat-string prompt injection (`v2.1-structured`):** `validateDirectModelV2_1` validates typed `serviceOutputs` objects directly without scanning customer `CASE:` text, checks Direct-LLM's own `draftResponse` for self-contradiction, and fixes the `denyMentionedV2` proximity false positive (`fresh-valid-review-handoff-prose`). Legacy flat strings fall back only after `lastIndexOf('\nVERIFIED SUPPORT RECORD')`. Both `validateDirectModelV1` and `validateDirectModelV2_0` remain exported and tested so the progression stays reproducible.
2. **Honest ceiling on regex entailment (`regex-stress-v1.0` = `0/4`):** `composerGuardV2_1` was deliberately **not** patched for the 4 adversarial cases in `regex-stress-v1.0`. Regex keyword/window rules hit a hard precision-recall ceiling on unseen paraphrases and conditional clauses; production contradiction checking requires a semantic NLI/verifier stage.
3. **Pending live execution (`requiresLiveModel`, `4` unique cases):** `chal-customer-contradicts-timeline`, `chal-customer-contradicts-status`, `chal-judgment-outage-exception`, and `chal-judgment-legal-threat-first-refund` require live LLM/Jev evaluation rather than deterministic contract checks.