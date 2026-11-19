const ROWS: {
  boundary: string
  rules: string
  composed: string
  validator: string
  direct: string
  react: string
}[] = [
  {
    boundary: 'Evidence explicit',
    rules: '✓ verified facts',
    composed: '✓ verified facts',
    validator: '✓ injected inline',
    direct: '✓ injected inline',
    react: 'tool-gated fetch',
  },
  {
    boundary: 'Semantic route',
    rules: 'none (policy only)',
    composed: 'explicit (LLM → typed contract)',
    validator: 'implicit',
    direct: 'implicit',
    react: 'implicit',
  },
  {
    boundary: 'Decision typed',
    rules: '✓ deterministic TS',
    composed: '✓ contract + guardrail',
    validator: '✓ schema + structured check',
    direct: 'JSON (unvalidated)',
    react: 'JSON at loop end',
  },
  {
    boundary: 'Judgment authority',
    rules: '4-line policy rules',
    composed: 'Jev + contracts',
    validator: 'LLM + deterministic validator',
    direct: 'LLM',
    react: 'LLM',
  },
  {
    boundary: 'Fail-closed (halt) path',
    rules: 'Yes (missing/fault)',
    composed: 'Yes (per stage)',
    validator: 'Yes (post-call)',
    direct: 'No',
    react: 'No',
  },
  {
    boundary: 'Handles prose ambiguity',
    rules: 'No (fails 2/15)',
    composed: 'Yes (triage + Jev)',
    validator: 'LLM-dependent (fails 2/15)',
    direct: 'LLM-dependent',
    react: 'Mixed (escalates more)',
  },
]

export function AuthorityBoundaries() {
  return (
    <section className="card border border-base-300 bg-base-100 p-5">
      <h3 className="text-lg font-bold tracking-tight">Authority across architectures</h3>
      <p className="mt-0.5 text-xs text-base-content/60">
        Same refund domain, five allocations of authority — from pure deterministic rules to unconstrained tool loops.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Boundary</th>
              <th>0. Deterministic Rules</th>
              <th>1. Decision Router</th>
              <th>2. Direct + Validator</th>
              <th>3. Direct-LLM</th>
              <th>4. ReAct Agent</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.boundary}>
                <td className="font-medium">{r.boundary}</td>
                <td className="font-mono text-[var(--dr-det)]">{r.rules}</td>
                <td className="font-mono text-[var(--dr-det)]">{r.composed}</td>
                <td className="font-mono text-[var(--dr-det)]">{r.validator}</td>
                <td className="font-mono text-[var(--dr-llm)]">{r.direct}</td>
                <td className="font-mono text-[var(--dr-llm)]">{r.react}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
