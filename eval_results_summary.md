# Decision Router — Benchmark Summary

**What this experiment is:** an evaluation of *authority routing* — whether
separating semantic interpretation, fact establishment, bounded judgment,
contract validation, and response composition into independently constrained
stages produces observable fail-closed behavior — on a small, explicitly
defined refund-policy domain. It is not a proof that the composed
architecture is generally more accurate, nor that Jev is more accurate than
an LLM in general.

**Headline, stated carefully:** in the v1 benchmark, the composed
architecture **matched the direct-LLM baseline on ordinary decision
accuracy (86.7% each, 26/30)** while **halting instead of deciding on all
tested fail-closed cases (10/10), where both monolithic baselines decided
in every case (0/10)**. The overall-accuracy gap (90.0% vs 65.0%/57.5%) is
arithmetic — it is fully explained by the fail-closed rows — not a second
independent finding.

**Methodology & dataset:** 20 scenarios (11 live-app fixtures in
`src/data/scenarios/*.json` + 9 policy-boundary edge variants from
`scripts/lib/scenarios.ts`) × 3 architectures × 2 repeats (N = 120 runs).
Gold expectations in `src/lib/live/gold.ts`; harness in `scripts/eval.ts`.
**Reproduction:** `npm run eval -- --pipelines cot,react,router --repeat 2 --concurrency 1 --live-base http://localhost:5173`
(requires dev server plus `OPENCODE_*`/`JEV_*`/`GEMINI_*` credentials; see
README §10).
**Raw results:** [`eval-results.json`](./eval-results.json) (v1; preserved
as `eval-results-v1.json`)
**Detailed reports:** [`docs/EVAL_REPORT_STE100.md`](./docs/EVAL_REPORT_STE100.md),
[`docs/EVAL_REPORT_STANDARD.md`](./docs/EVAL_REPORT_STANDARD.md)
**Follow-ups:** [model separation (Task 3)](./docs/model-separation.md),
[fault-injection fairness (Task 2)](./docs/fault-injection.md),
[rigor notes (Task 4)](./docs/rigor.md)

> **Foundation-model confound (read first):** the v1 run does not isolate
> architecture from model choice. The router's LLM stages run Big Pickle
> (via the local OpenCode server) and its judgment runs the real Jev
> Decision API; the v1 baselines run Gemini flash-lite. V1 numbers therefore
> represent **architecture + foundation-model configuration**, not
> architecture in isolation. A matched-model follow-up (Task 3, repeat = 1)
> is consistent with the halt difference being structural, but does not
> establish it conclusively — see §6.

---

## 1. Benchmark matrix, v1 (N = 120)

From `eval-results-v1.json` (baselines on Gemini flash-lite; router on
Big Pickle LLM stages + Jev):

| Architecture | Overall (40 runs) | Decision accuracy (gold = decide, 30 runs) | Fail-closed handling (gold = halt, 10 runs) | Fabricated values | Unauthorized actions | Mean latency | Mean tokens |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Router** (composed) | 90.0% (36/40) | **86.7%** (26/30) | **100%** (10/10) | 0 | 0 | 9,860 ms | 1,585 tok |
| **Direct-LLM** (CoT + JSON) | 65.0% (26/40) | **86.7%** (26/30) | 0% (0/10) | 0 | 0 | 2,096 ms | 527 tok |
| **ReAct** (tool loop) | 57.5% (23/40) | 76.7% (23/30) | 0% (0/10) | 0 | 0 | 4,045 ms | 887 tok |

How to read this: on well-formed refund decisions the router and the
direct-LLM baseline tied exactly (26/30 each). The router's overall lead
comes entirely from the 10 fail-closed runs, where it halted and the
baselines forced a decision. ReAct additionally lost ~10 points on decisions
by escalating valid refunds (symmetric scoring penalizes unnecessary
review).

---

## 2. Research problem & hypotheses

Customer-support automation typically grants one model call implicit
authority over everything: it interprets intent, recalls facts, applies
policy, and drafts prose in a single generation. That coupling leaves no
stage boundary at which to catch corruption — and no explicit state in which
the system can refuse to decide.

- **Null hypothesis (H₀):** monolithic prompts and unconstrained ReAct loops
  provide equal decision accuracy and fail-closed handling to composed
  pipelines with typed contracts (P_Router = P_Baseline).
- **Alternative hypothesis (H₁):** composed architectures with typed boundary
  contracts and bounded judgment achieve superior fail-closed handling on
  corrupted and ambiguous inputs.

The tested hypothesis is about *failure boundaries*, not general
intelligence: H₁ predicts a non-zero halt rate on the defined fault set,
which is what the fail-closed rows measure.

---

## 3. Epistemic hygiene & Goodhart controls

1. **Anti-gaming (symmetric scoring):** if fail-closed handling were measured
   alone, an agent could score perfectly by escalating *every* ticket. Valid
   decidable cases penalize unnecessary review, so blanket escalation fails.
   ReAct dropped to 76.7% decision accuracy partly for this reason.
2. **Entailment guardrail vs. keyword memorization:** emitting the right
   reason code in JSON while writing a contradicting email is caught by the
   composer's deterministic contradiction check (`composer_contradiction`),
   not by string matching on the decision field.
3. **Zero-dollar grounding invariant:** fixtures contain no dollar amounts or
   dates, so any currency string in generated prose is an objective
   fabrication finding — no LLM-as-judge subjectivity. All arms scored 0
   fabrications in v1.

---

## 4. Key findings (scoped to what was measured)

1. **Fail-closed divide on the defined fault set (10/10 vs 0/10):** on the 5
   fault-injection scenarios × 2 repeats (malformed router JSON, unconfident
   route, Jev unreachable, invalid Jev enum, composer contradiction), the
   router halted through its real failure branches every time; both
   monolithic baselines emitted a decision every time. See §5–6 for the
   confounds and scope limits on this claim.
2. **Decision-accuracy tie on well-formed cases:** router and Direct-LLM both
   26/30 (86.7%). Nothing in v1 supports "the composed architecture decides
   more accurately" — the evidence supports "it decides equally well and
   refuses explicitly when it should not decide."
3. **Intent-sycophancy pattern:** on `ambiguous-plan` (*"Can you help me with
   my plan?"*), the baselines assumed refund intent and approved; the router
   routed to human triage. One scenario, not a general anti-sycophancy proof.
4. **ReAct drift pattern:** ReAct scored lowest on decisions (76.7%),
   including premature escalation of valid refunds and reason-code confusion
   (`regular_review` for `irregular_review` on repeat refunds). Consistent
   with scratchpad-drift costs of tool loops on this task; not a general
   verdict on agents.
5. **Latency cost:** ~9.8 s mean for the composed run vs ~2.1 s Direct-LLM.
   Sequential contract validation costs time; whether the trade is worth it
   depends on the stakes of the decision, which this benchmark does not
   price.

---

## 5. What "fail-closed handling" means here (and does not)

"Fail-closed handling" = on the explicitly defined failure conditions, the
run halts (`error`/`triage`, no consequential decision) instead of forcing
an answer. Tested conditions: ambiguous routing, malformed/missing router
output, missing verified facts, Jev unreachable or invalid judgment
(including sub-0.55 confidence demotion), and composer output contradicting
the decision. The benchmark executes no payments, so "no unauthorized
action" means no approve/deny was emitted on a halt-gold run — not a live
payments-safety certification.

The architectural observation is narrow: the composed system has explicit
states in which it refuses a consequential decision. Do not generalize this
to AI safety at large.

---

## 6. Confounds, scope limits, and follow-up evidence

- **Architecture-specific cases.** Several fault kinds describe components
  only the router has (notably `jev-500`: a judgment-stage outage). They are
  excluded from baseline denominators (`docs/fault-injection.md`), so the
  comparison demonstrates whether the architecture can represent and enforce
  explicit failure boundaries — not an unbiased universal safety ranking.
- **Foundation-model confound (v1).** Router = Big Pickle + Jev; baselines =
  Gemini flash-lite. Matched-model follow-up (Task 3,
  `docs/model-separation.md`, repeat = 1, both models): monolithic baselines
  halted 0/4–0/5 on faults under both models and both prompt conditions
  (including an explicit halt instruction), while the deterministic validator
  arm halted 4/4 on both models with zero LLM calls. Consistent with the halt
  difference being structural rather than a model artifact — but one
  repeat-1 draw, reported as-is, not a conclusive decomposition.
- **Policy/gold-label scope.** Gold is derived from the same stated refund
  policy the Jev judge is told (`src/lib/live/gold.ts` vs `jevQuestions` in
  `src/lib/live/pipeline.ts`). The benchmark tests reliable routing +
  bounded judgment + policy-constrained decision formation on a known
  domain — not whether Jev discovers correct policy independently.
- **Reason-code vocabulary inconsistency (flagged, unchanged):** gold expects
  `regular_review` for ambiguous-intent and missing-facts escalations while
  the live pipeline's `REASON_ALLOWED` permits only `irregular_review` for
  `request_review`. Verdict logic accepts a triage halt on a
  `request_review` gold, so v1 scoring is unaffected — but the vocabularies
  disagree and should be unified deliberately.

---

## 7. Limitations

- Model configurations differ across architectures in v1 (see §6 confound).
- Small benchmark: 20 scenarios, v1 at 2 repeats (N = 120 runs).
- V1 numbers are single-run point estimates; no variance or confidence
  interval (repeat-5 + Wilson-CI instrumentation covers baselines only —
  `docs/rigor.md`, `eval-results-*-rep5.json`).
- Fail-closed cases are architecture-aware, not a universal safety test.
- Bounded policy domain (30-day refund policy over four fixture fields).
- Does not establish that Jev is more accurate than an LLM in general, or
  causal architectural superiority outside the tested conditions.
- Prototype evaluation, not production reliability: fixture facts, not live
  databases; single-turn inputs; no auth/payments infrastructure; the live
  benchmark pipeline executes no consequential actions.

---

## 8. Takeaways for system builders (hypotheses, not laws)

- **Separate decision authority into stages.** Never let the model that
  writes the email also be the component that authorizes the disbursement.
  Keep authorization in typed judgments plus deterministic contract
  validation.
- **Make halting an explicit, scorable state.** A transfer to human triage
  is a successful outcome on corrupt input; a forced decision is the
  failure. If your architecture cannot represent "refuse," it cannot be
  measured — or trusted — on failure handling.
- **Validate at every stage boundary, deterministically.** Schema, enums,
  required facts, decision/reason consistency, composer entailment: each is
  a cheap check that fires even when the model is confidently wrong.
- **Emit audit artifacts per stage** (route contract, fact snapshot, signed
  judgment, guardrail verdict) rather than one opaque generation, so every
  failure is attributable to the stage that produced it.
