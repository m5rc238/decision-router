# Decision Router

A React/TypeScript demo that makes the division of labor in an intelligent
support system explicit:

```
Input → deterministic operations → Jev judgment → deterministic action → LLM (prose only)
```

Three kinds of work, three different tools:

| Work | Tool | Used for |
| --- | --- | --- |
| Deterministic actions | plain code | retrieval, calculations, eligibility rules, executing the refund |
| Semantic judgment | Jev (mock adapter) | bounded interpretation: intent & escalation, as calibrated probability distributions |
| Generative work | LLM (mock adapter) | composing the final natural-language answer from already-resolved facts |

The core rules the demo enforces:

- **No LLM where deterministic code suffices.** Lookups, math, eligibility and
  state changes are pure functions.
- **Jev judges, never executes.** It returns a probability distribution +
  confidence over a fixed candidate set. It never touches data or side effects.
- **The LLM is not the router.** It is only invoked after facts and decisions
  exist, purely to write prose.

## Run it

```bash
npm install
npm run dev
```

UI stack: React 19 + TypeScript, styled with **Tailwind CSS v4** and
**DaisyUI** (theme defined in `src/index.css`). Run a preset example, or type a
message and pick a customer — the trace shows which component handled each
step. Toggle **Compare with LLM-only** to see the same input shot through a
single opaque model call.

## Architecture

```
src/
  types.ts                         shared domain + trace types
  data/mockData.ts                 local mock customers/subscriptions/invoices/payments/refunds
  lib/
    deterministic/                 pure, rule-based layer (retrieval, totals, duplicates,
                                   eligibility, action that executes the refund)
    adapters/
      jev/types.ts                 JevAdapter contract (classify → distribution + confidence)
      jev/mockJevAdapter.ts        heuristic stand-in — clearly NOT the real Jev API
      llm/types.ts                 LlmAdapter contract (generate → prose from structured facts)
      llm/mockLlmAdapter.ts        template stand-in
    pipeline/
      composed.ts                  the reference workflow
      llmOnly.ts                   the LLM-only comparison
      runner.ts                    wires adapters + presets; reset demo state
```

## Swapping in real adapters

The pipeline never imports concrete adapters. `lib/pipeline/runner.ts` is the
only wiring point:

```ts
export const adapters = {
  jev: realJevAdapter,   // implement src/lib/adapters/jev/types.ts against real Jev
  llm: realLlmAdapter,   // implement src/lib/adapters/llm/types.ts against a real model
}
```

The mock adapters are explicitly **not** the real Jev/Llm APIs and don't
invent any. A real adapter maps the actual provider API onto the same narrow
interface, so no pipeline or UI changes are needed.

## Scope

Deliberately not included: auth, payments, real databases, production infra.
All state lives in mock modules so any run can be reset in one click.

Mock data is date-sensitive for the 90-day refund window (payments are dated
around Sep 2026) — edit `src/data/mockData.ts` to lean on the demo's clock.