# Decision Router — Empirical Benchmark Summary

Empirical benchmark of three customer-support automation architectures on a shared,
gold-labeled scenario suite. Reproduction: `npm run eval` (see `scripts/eval.ts`).

## Scenarios (20)

- **15 decidable refund cases** — purchase age spans 0 to 200+ days, exact 30/31-day
  boundary cases, active and cancelled accounts, and repeat-refund (2+) escalation
  policy. Each has a gold decision derived from the business rules
  (`src/lib/live/gold.ts`).
- **5 fail-closed safety cases** — ambiguous intent (human triage) and architecture-level
  fault-tolerance cases (router malformed JSON / missing route, judge errors, composer
  contradiction). The correct behavior is to *halt without deciding*; for the baselines,
  which have no halt state, producing any decision on these cases is itself a failure.

## Results

| # | Architecture Pattern | Domain Decision Acc | Fail-Closed Safety | Overall Accuracy | Fabricated Values | Mean Latency |
|---|----------------------|--------------------:|-------------------:|-----------------:|------------------:|-------------:|
| 1 | **Decision Router** (Composed) | **86.7% (13/15)** | **100.0% (5/5)** | **90.0% (18/20)** | 0 | 4.9 s |
| 2 | Direct LLM + Structured Output | 86.7% (13/15) | 0.0% (0/5) | 65.0% (13/20) | 0 | 1.9 s |
| 3 | ReAct Agent (Tool Calling) | 60.0% (9/15) | 0.0% (0/5) | 45.0% (9/20) | 0 | 1.3 s |

## Key Findings

1. **The Decision Router matched the Direct LLM baseline on ordinary domain-decision
   accuracy** (13/15, 86.7% each). Its principal observed difference in this benchmark
   was fail-closed behavior, not basic domain accuracy.
2. **Only the evaluated Decision Router implementation has an explicit fail-closed path.**
   On the 5 safety cases — where any decision counts as a failure — it halted correctly
   in all five cases (5/5). The two baseline implementations have no equivalent halt state
   and therefore produced decisions on these cases (0/5). The benchmark tests the
   consequences of making halting an explicit architectural state, rather than claiming
   the router possesses a safety property the baselines were designed to lack.
3. **The Direct LLM + Structured Output baseline is capable but not fail-closed.** It
   matches the router on domain accuracy, but on the ambiguous case — where the gold
   behavior requires escalating to human review — it produces a confident approval
   decision instead of abstaining. It has no halt path.
4. **The evaluated ReAct Agent implementation produced the lowest domain accuracy**
   (9/15, 60%). Observed errors included over-escalation (requesting review on decidable
   cases such as a just-bought refund and a cancelled account) and premature decisions
   (approving the ambiguous case). It has no halt path. These are single-run results per
   scenario; no variance estimate is claimed.
5. **Mean latency is a throughput trade.** The router's typed contracts, verification
   and separate judge averaged ~4.9 s versus 1.9 s and 1.3 s for the single-call
   baselines. Fail-closed behavior carries a latency cost, not a free safety win.
6. **No fabricated monetary amounts or dates were observed** in this run for any
   architecture (`Fabricated Values` column). This is an observed result for this
   benchmark run, not evidence that fabrication is impossible. The router's composer is
   instructed to ground its reply in verified evidence and not invent amounts, dates or
   refunds, and its guardrail deterministically rejects messages that contradict the
   decided outcome; there is no deterministic value validator, so a 0 here remains a
   measured outcome, not a guarantee.

## Method

- The benchmark consists of **15 decidable refund cases** and **5 safety / fail-closed
  cases**. On the safety cases, producing any decision is itself a failure.
- Every scenario carries a **gold expectation** — the ideal decision (or the halting
  behavior) — derived from the same business rules given to the judge
  (`src/lib/live/gold.ts`).
- All three architectures read the **same deterministic support record**; the ReAct
  agent must fetch it via `get_support_record` before deciding.
- Outcomes are compared against gold check-by-check (route, decision, reason code,
  guardrail) for a strict PASS/MISMATCH verdict (`verdictForRun` / `verdictForOutcome`).
- The five safety cases are **architecture-level fault-tolerance cases**: faults
  (malformed router JSON, missing route, judge error, invalid judgment, composer
  contradiction) are injected into the router's stages. The baselines have no equivalent
  components, so these are not identical component-failure tests; they test whether each
  architecture can signal that it cannot safely decide.
- Fabricated-value detection scans each output for monetary amounts and absolute dates —
  the facts domain contains none, so any occurrence would be an invented claim.
- **Mean** (average) pipeline wall-time is reported in the table; token cost and
  per-case check details are written to `eval-results.json` (single run per scenario).
- **Tooling mismatch (limitation).** The router's LLM stages run on Big Pickle (OpenCode,
  local) with the Jev judge; both baselines run on Google Gemini (gemini-flash-lite-latest).
  Scores therefore reflect architecture-plus-foundation-model, not architecture in
  isolation. A same-model rerun would isolate the architecture effect; until then, treat
  cross-architecture differences as implementation-and-model specific.