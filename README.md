# Decision Router

**Decision Router is an experiment in authority routing for AI systems.**

The architectural question it explores is not simply:

> Which model should answer?

but:

> **Which component is allowed to make which kind of decision?**

A generative model should not implicitly determine the semantic space,
epistemic basis, decision authority, and final expression of the same
operation. These responsibilities can instead be represented as separable
stages that are independently constrained and validated. That separation —
not any single model — is the main architectural idea of this repository,
and it is presented here as a hypothesis under exploration, not as an
experimentally proven universal law.

## 1. What this is

A TypeScript/React prototype of a customer-support refund system built as a
**composed pipeline** with explicit stage boundaries, alongside the
monolithic baselines it is compared against. The benchmark domain is a
known, explicitly defined refund policy (30-day window, active-account
requirement, repeat-refund escalation) over fixture facts — so the
experiment tests whether the system can reliably apply a stated policy
through separated stages, not whether any component invents correct
business policy on its own.

The repository contains two pipelines — do not confuse them:

- **Live benchmark pipeline** (`src/lib/live/pipeline.ts`): the architecture
  under evaluation. Semantic routing → contracts → verified facts → bounded
  judgment → response composition, with fail-closed branches. It forms
  decisions and generates responses. It executes no payments or refunds.
- **Demo pipeline** (`src/lib/pipeline/composed.ts`): an earlier, broader
  end-to-end sketch that *does* include simulated deterministic action
  execution (`executeRefund`, flag-for-review) against local mock data, using
  the heuristic `mockJevAdapter`. It demonstrates the wider architecture; it
  is not what the benchmark scores.

## 2. The architectural idea: authority routing

Each stage of the pipeline holds exactly one kind of authority, and each
authority is constrained by the stages before it:

| Responsibility | Held by | Constrained by |
| --- | --- | --- |
| Semantic interpretation / routing | Semantic Router (LLM) | Fixed route catalog, JSON contract |
| Selection of a bounded `decision_space` | Semantic Router (LLM) | Known policy domains (`plan_change_policy`, `duplicate_charge`, …) |
| Retrieval / establishment of verified facts | Deterministic / source layer | Fixture record (in production: DB/API) — never model memory |
| Bounded semantic judgment | Jev | Permitted decision space, typed questions, confidence threshold |
| Decision-contract validation | Deterministic code | Allowed decisions, reason codes, evidence requirements |
| Consequential action | Out of scope for the benchmark | (Demo pipeline only: deterministic `executeRefund`) |
| Natural-language generation | Response Composer (LLM) | Already-established decision + guardrail |

The point: no single model call spans interpretation, fact-finding, policy
application, and prose at once. The LLM stages interpret and express; they
do not authorize. Authorization lives in the judgment plus its deterministic
validation envelope.

## 3. Architecture diagram (live benchmark pipeline)

```text
User Input
    ↓
Semantic Router (LLM: Big Pickle via the local OpenCode server)
    ↓
Route Contract (deterministic validation → typed contract or triage)
    ↓
Verified Facts (deterministic fixture lookup — never model memory)
    ↓
Jev Bounded Judgment (real Jev Decision API over typed questions)
    ↓
Decision Contract (deterministic validation: enums, reason codes,
                   confidence ≥ 0.55, evidence requirements)
    ↓
Response Composer (LLM: renders the already-made decision into prose)
    ↓
User Response
```

Each `↓` between stages is a validation boundary with its own fail-closed
branch (see §8). Stage implementations live in `src/lib/live/pipeline.ts`;
the dev-server credential boundary lives in `server/live.ts`.

## 4. How the pipeline works, stage by stage

### Semantic Router

The LLM classifies the request into a typed route plus a `decision_space`
(`src/lib/live/pipeline.ts`, `routerPrompt`). Routing is intent-only: a
refund request routes to `refund_request` even when eligibility is unknown,
because eligibility is decided later. The router **does not make the
business decision** — it never approves, denies, or applies policy.

### Route Contract

`validateRouter` converts the router's JSON into an explicit structured
contract (`route`, `decisionSpace`, `extractedEntities`, `ambiguity`) or
fails. Unknown routes, malformed JSON, and `human_triage` routes halt the
run here (status `triage`/`error`) instead of forcing a decision downstream.

### Verified Facts

Facts (`purchase_age_days`, `refund_window_days`, `account_status`,
`previous_refunds_count`) come from the scenario fixture — the stand-in for
the authoritative system of record. If no facts exist, the pipeline halts
with `facts_missing` rather than letting a model guess undisputed facts.

### Jev: bounded semantic judgment

Jev receives the user request, the route contract, and the verified facts,
plus two typed questions (`refund_decision`, `reason_code`) whose criteria
encode the stated refund policy (`jevQuestions`). It returns a choice +
confidence per question.

> Jev provides a typed judgment layer in which the application's semantic
> decision space can be made explicit and bounded.

Jev does not "solve truth," and it is not merely a classifier bolted on for
labels: it performs the bounded semantic judgment — applying the stated
policy to the verified facts inside the permitted decision space — while
deterministic validation constrains and checks that judgment. Precisely:

> **Deterministic systems establish verified facts and enforce contracts;
> Jev performs bounded semantic judgment within the permitted decision
> space.**

Low-confidence judgments (< 0.55) are demoted to `request_review` /
`irregular_review` rather than put on the wire; unknown decisions or
decision/reason mismatches halt with `jev_invalid_output`; an unreachable
Jev halts with `jev_error`.

### Decision Contract

`buildDecision` plus the `decision_contract` stage validate the judgment
against the allowed decision set (`approve_refund`, `deny_refund`,
`request_review`), the allowed reason codes per decision, and the evidence.
Only a validated contract reaches the composer.

### Response Composer

The LLM translates the already-established decision into a short customer
message (`composerPrompt`). It has **no authority to change, reinterpret, or
override the judgment**. A deterministic guardrail (`composerGuard`) rejects
any message that contradicts the decision (`composer_contradiction`) —
e.g. approval language under a denial, or any definitive outcome under a
`request_review`.

## 5. Why authority routing

Monolithic setups give one model call implicit authority over every
responsibility at once: it reads the request, recalls (or invents) facts,
applies policy, and writes the email in a single opaque generation. When
that call is wrong, there is no stage boundary at which to catch it, and no
explicit state in which the system can refuse to decide.

The composed pipeline replaces that single implicit authority with
separable, independently constrained stages. The observable payoff measured
here is narrow and specific: the composed system has explicit states in
which it refuses to produce a consequential decision instead of forcing an
answer (§8). Nothing in this repository proves a general claim about AI
safety — only that this architecture can represent and enforce explicit
failure boundaries on the tested cases.

## 6. Benchmark

The eval harness (`scripts/eval.ts`, `scripts/fault-eval.ts`) runs a fixed
scenario set against three architectures:

- **Router (live)** — the pipeline in §3–4. LLM stages call Big Pickle
  through the dev middleware (`/api/live/llm` → local OpenCode desktop
  server); judgment calls the real Jev Decision API (`/api/live/jev`).
- **Direct-LLM (CoT + JSON)** — one model call over the user input plus the
  support record, emitting `{ decision, reason, email }` (`scripts/lib/cot.ts`).
- **ReAct agent** — a tool-calling loop with `get_support_record` /
  `execute_refund` (`scripts/lib/react.ts`).
- **Direct+validator** (Tasks 2–3) — Direct-LLM followed by a deterministic,
  zero-LLM-call structural validator (`scripts/lib/validator.ts`).

Scenario set: 11 live-app fixtures (`src/data/scenarios/*.json`) plus 9
policy-boundary edge variants mined from the gold rules
(`scripts/lib/scenarios.ts`), for **20 scenarios**. Gold expectations
(`src/lib/live/gold.ts`) are derived from the same stated policy the Jev
judge is told: approve iff within window on an active account, deny outside
it / when inactive, escalate repeat-refund / ambiguous cases to review, and
halt on corrupt or missing inputs. Scoring is symmetric: unnecessary review
on an unambiguous case fails just as a wrong decision does.

The headline v1 run: 20 scenarios × 3 architectures × 2 repeats (N = 120),
baselines on Gemini flash-lite. See `eval_results_summary.md` for the full
matrix, and `docs/` for the detailed reports (`EVAL_REPORT_STANDARD.md`,
`EVAL_REPORT_STE100.md`), the fault-injection fairness record
(`docs/fault-injection.md`), the model-separation follow-up
(`docs/model-separation.md`), and the instrumentation notes (`docs/rigor.md`).

## 7. Results (v1, stated carefully)

> In the current benchmark, the composed architecture matched the direct-LLM
> baseline on ordinary decision accuracy while outperforming the tested
> baselines on explicitly defined fail-closed cases.

Concretely (`eval-results-v1.json`, preserved as `eval-results.json`):

| | Router (composed) | Direct-LLM | ReAct |
| --- | :---: | :---: | :---: |
| Decision accuracy (gold = decide, n = 30) | **86.7%** (26/30) | **86.7%** (26/30) | 76.7% (23/30) |
| Fail-closed handling (gold = halt, n = 10) | **100%** (10/10) | 0% (0/10) | 0% (0/10) |
| Overall (n = 40) | 90.0% (36/40) | 65.0% (26/40) | 57.5% (23/40) |

The overall-accuracy gap is arithmetic, not a second independent finding:
it is fully explained by the fail-closed rows, where baselines force a
decision on corrupt input. Do not present this as "Decision Router is 90%
accurate while LLMs are only 65% accurate" — on well-formed decisions the
two tied.

**Foundation-model confound.** The v1 run does not isolate architecture from
model choice: the router's LLM stages run Big Pickle and its judgment runs
Jev, while the v1 baselines run Gemini flash-lite. V1 results therefore
represent **architecture + foundation-model configuration**, not
architecture in isolation. A matched-model follow-up (Task 3,
`docs/model-separation.md`, repeat = 1) re-ran all baselines on Big Pickle:
fail-closed behavior was unchanged on both models (monolithic baselines
0/4–0/5 on faults regardless of model; the deterministic validator halted
4/4 on both), which is consistent with the halt difference being structural,
but a single repeat-1 draw does not establish this conclusively. Later
repeat-5 runs (`eval-results-*-rep5.json`) cover baselines only and are
reported in `docs/rigor.md`.

## 8. Fail-closed handling: what the benchmark actually measures

"Fail-closed handling" here means: on explicitly defined failure conditions,
the system halts (status `error`/`triage`, no consequential decision
emitted) instead of forcing an answer. The tested conditions are:

- ambiguous routing (`human_triage` / unknown route → halt to triage)
- malformed or missing router output (`router_malformed_json`)
- missing verified facts (`facts_missing`)
- Jev unreachable (`jev_error`) or invalid judgment (`jev_invalid_output`,
  including decision/reason mismatch and sub-threshold confidence)
- composer output contradicting the decision (`composer_contradiction`)

The meaningful architectural observation is that the composed system has
explicit states in which it can refuse a consequential decision. Two
qualifications apply:

1. These cases are **architecture-aware**: several fault kinds (notably
   `jev-500`, a judgment-stage outage) describe components the baselines do
   not have, and are excluded from baseline denominators
   (`docs/fault-injection.md`). The benchmark therefore demonstrates whether
   the architecture can represent and enforce explicit failure boundaries —
   it is not an unbiased universal safety comparison, and it proves nothing
   about general AI safety.
2. A prompt-only halt instruction did not change baseline behavior (0/4 told
   vs 0/4 not-told in the Task-2 fault test), while a deterministic
   structural validator halted 4/4 on both models. The evidence is consistent
   with fail-closed behavior coming from structure (validation boundaries),
   not from wording — at the tested scale.

## 9. Demo vs benchmark

```text
Demo pipeline (src/lib/pipeline/composed.ts + mock adapters)
- demonstrates the broader end-to-end architecture, including simulated
  deterministic action execution (executeRefund / flag-for-review)
- runs entirely locally on mockJevAdapter (keyword heuristic) + mockLlmAdapter
- is NOT scored by the benchmark and says nothing about real Jev

Benchmark pipeline (src/lib/live/pipeline.ts + server/live.ts)
- evaluates semantic routing, bounded judgment, decision contracts,
  response composition, and fail-closed behavior
- calls real services (Big Pickle LLM stages, real Jev Decision API)
- executes no payments or refunds; "actions" never leave the trace
- does not constitute a production payment/refund execution system
```

## 10. Running it

```bash
npm install
npm run dev
```

UI stack: React 19 + TypeScript, styled with **Tailwind CSS v4** and
**DaisyUI** (theme defined in `src/index.css`). Run a preset example, or type
a message and pick a customer — the trace shows which component handled each
step. Toggle **Compare with LLM-only** to see the same input shot through a
single opaque model call.

Live services need credentials (see `.env.example`): `OPENCODE_SERVER_*`
for the Big Pickle runtime, `JEV_API_*` for the real Jev Decision API,
`GEMINI_*` for the eval baselines. Without them, only the mock-adapter demo
path runs — and mock-adapter behavior must never be cited as evidence about
Jev.

Benchmark:

```bash
# baselines only (needs GEMINI_API_KEY)
npm run eval -- --pipelines cot,react --repeat 2
# including the live router (needs a running dev server + OPENCODE/JEV creds)
npm run eval -- --pipelines cot,react,router --repeat 2 --live-base http://localhost:5173
npm run fault-eval   # fault-injection matrix for the baselines
```

## 11. Limitations

- **Model configurations differ across architectures in v1** (Big
  Pickle + Jev vs Gemini flash-lite): results are architecture +
  foundation-model configuration, not architecture in isolation.
- **Benchmark size is small**: 20 scenarios (11 fixtures + 9 edge
  variants); v1 at 2 repeats (N = 120 total runs).
- **Single-run results unless otherwise stated**; no variance or confidence
  interval is established from the v1 run (repeat-5/CI instrumentation is
  in `docs/rigor.md` for baselines).
- **Fail-closed cases are architecture-aware**, not a universal safety
  test; baselines lack equivalent contract/abstention stages by construction.
- **The policy domain is intentionally bounded**: a stated 30-day refund
  policy over four fixture fields. The test is reliable routing + bounded
  judgment + policy-constrained decision formation — not discovery of
  business policy.
- **The benchmark does not establish that Jev is more accurate than an LLM
  in general**, nor that the composed architecture is causally superior in
  all settings.
- **This is a prototype evaluation, not production reliability**: fixture
  facts instead of live databases, single-turn inputs, no auth/payments
  infra, and a latency cost (~9.8 s mean for the composed run vs ~2.1 s for
  Direct-LLM in v1) that is out of scope for correctness claims.

## 12. What this experiment does / does not establish

Does establish (at the tested scale, with the stated confounds):

- The composed pipeline tied the direct-LLM baseline on well-formed refund
  decisions (86.7% / 26/30 each) and halted instead of deciding on all 10
  tested failure runs, where the monolithic baselines decided in all 10.
- Explicit validation boundaries can convert corrupt/ambiguous inputs into
  observable halts rather than forced decisions — including against a
  prompt-only halt instruction, which changed nothing.

Does not establish:

- That the composed architecture is more accurate in general, or that Jev
  is intrinsically more intelligent than an LLM.
- That the results isolate architecture from model choice (see §7 confound).
- General AI safety, production readiness, or scientific conclusiveness.
- That all decisions are deterministic: the LLM performs real semantic
  interpretation in the router and composer, and Jev performs the bounded
  judgment. Determinism lives in fact establishment and contract
  enforcement, not in every decision.

## Appendix A. Code map

```text
src/
  types.ts                         shared domain + trace types
  data/mockData.ts                 local mock customers/subscriptions/invoices/payments/refunds
  data/scenarios/*.json            11 live-app fixtures (user input + verified facts + faults)
  lib/
    deterministic/                 pure, rule-based layer (retrieval, totals, duplicates,
                                   eligibility, action that executes the refund — demo only)
    adapters/
      jev/types.ts                 JevAdapter contract (classify → distribution + confidence)
      jev/mockJevAdapter.ts        heuristic stand-in — clearly NOT the real Jev API
      llm/types.ts                 LlmAdapter contract (generate → prose from structured facts)
      llm/mockLlmAdapter.ts        template stand-in
    pipeline/
      composed.ts                  the DEMO workflow (mock adapters, simulated execution)
      llmOnly.ts                   the LLM-only comparison
      runner.ts                    wires adapters + presets; reset demo state
    live/
      pipeline.ts                  the BENCHMARK pipeline (real LLM + real Jev, fail-closed)
      gold.ts                      gold expectations + verdict logic
      baseline.ts                  client for the live baseline panes
      types.ts                     live run/stage/contract types
server/live.ts                     dev middleware: credentials + LLM/Jev/baseline backends
scripts/
  eval.ts                          main benchmark harness
  fault-eval.ts                    fault-injection matrix for baselines
  lib/scenarios.ts                 20-scenario set (fixtures + 9 edge variants)
  lib/cot.ts lib/react.ts          baseline implementations
  lib/validator.ts                 deterministic structural validator arm
prompts/                           versioned baseline prompts (v1 vs v2-told)
```

## Appendix B. Swapping in real adapters (demo pipeline)

The demo pipeline never imports concrete adapters. `lib/pipeline/runner.ts`
is the only wiring point:

```ts
export const adapters = {
  jev: realJevAdapter,   // implement src/lib/adapters/jev/types.ts against real Jev
  llm: realLlmAdapter,   // implement src/lib/adapters/llm/types.ts against a real model
}
```

The mock adapters are explicitly **not** the real Jev/LLM APIs:

> The mock adapter exists to make the demo runnable without external Jev
> credentials. Benchmark claims about the Jev-backed architecture should not
> be inferred from mock-adapter behavior.

A real adapter maps the actual provider API onto the same narrow interface,
so no pipeline or UI changes are needed.

## Appendix C. Terminology

- **Semantic routing** — LLM maps input to a route + `decision_space`; no
  policy applied.
- **`decision_space`** — the bounded policy domain governing the request
  (e.g. `plan_change_policy`).
- **Verified facts** — fixture/DB record; the epistemic basis. Never model
  memory.
- **Bounded judgment** — Jev applies the stated policy to the facts inside
  the decision space and returns a typed choice + confidence.
- **Decision contract** — the validated judgment (decision + reason code +
  confidence + evidence) that alone may reach the composer.
- **Response composition** — LLM renders the contracted decision into prose;
  zero decision authority.
- **Fail-closed handling** — halting (triage/error) instead of forcing a
  decision on corrupt/ambiguous input. Preferred over unqualified "safety".
- **Deterministic execution** — simulated refund/flag actions in the *demo*
  pipeline only; the benchmark pipeline executes nothing consequential.

Known code-level inconsistency (flagged, not changed): `gold.ts` expects
reason code `regular_review` for ambiguous-intent and missing-facts
escalations, while `pipeline.ts` (`REASON_ALLOWED`) permits only
`irregular_review` for `request_review` — the live pipeline can never emit
the gold reason code on those paths. The verdict logic treats a triage halt
on a `request_review` gold as a pass, so scoring is unaffected, but the
reason-code vocabulary is incoherent across the two files and should be
unified deliberately, not silently.
