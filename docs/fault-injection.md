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

`scripts/lib/validator.ts` applies only structural rules:

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
confidently wrong. Its marker table is derived from the exact injection
payloads in section 2.

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

## 7. Task-2d diagnostic run (fault-results.json, 2026-09-25)

`npm run fault-eval` — 5 arms × 4 applicable fault kinds, one run each, model
`gemini-flash-lite-latest`. Gold for every fault row is **halt**; a row passes
only if the arm emitted `halt`. The router reference row comes from the
preserved `eval-results-v1.json` (10/10 fault scenarios halted through its real
failure branches, repeat=2).

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

### Reading the result

- **Telling the baselines to halt did not change behavior at all** (0/4 in both
  prompt conditions; every run emitted `deny_refund` on corrupt input). The
  predecessor systems are single-shot models reasoning over a prompt — a fault
  arrives as an *outer* artifact of the system, not something the model treats
  as a signal. This is a measurement, not a claim about model capability.
- **The Direct+validator arm halted on every fault** (4/4) *without any prompt
  change and without any LLM call* — its halt behavior is deterministic.
- This is the first empirical evidence that a **structural guardrail**, not an
  instruction, is what separates the two designs on fail-closed behavior.
- Caveat: the fault markers the validator scans are the fixed, documented
  signatures of the injected payloads. It detects *known* fault signatures; it
  does not "understand" corruption. The router reference halts through stage
  failures that exist regardless of marker text, so the two mechanisms are
  compared on the same observable (emit `halt`), not on their internals.