const ROWS: { boundary: string; composed: string; direct: string; react: string }[] = [
  { boundary: 'Evidence explicit', composed: '✓ verified facts', direct: '✓ injected inline', react: 'tool-gated fetch' },
  { boundary: 'Semantic route', composed: 'explicit (LLM → typed contract)', direct: 'implicit', react: 'implicit' },
  { boundary: 'Decision typed', composed: '✓ contract + validator', direct: 'structured JSON (unvalidated)', react: 'JSON at loop end' },
  { boundary: 'Judgment authority', composed: 'Jev', direct: 'LLM', react: 'LLM' },
  { boundary: 'LLM selects the action', composed: 'No (pipeline)', direct: 'No (single call)', react: 'Yes (chooses tools)' },
  { boundary: 'Fail-closed (halt) capability', composed: 'Yes', direct: 'No', react: 'No' },
  { boundary: 'LLM role in response', composed: 'translates only', direct: 'decides + writes', react: 'decides + writes' },
]

export function AuthorityBoundaries() {
  return (
    <section className="card border border-base-300 bg-base-100 p-5">
      <h3 className="text-lg font-bold tracking-tight">Authority across architectures</h3>
      <p className="mt-0.5 text-xs text-base-content/60">
        The same case, different allocation of authority — not a benchmark, and no &ldquo;best&rdquo; label.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Boundary</th>
              <th>1. Decision Router (Composed)</th>
              <th>2. Direct LLM + Structured Output</th>
              <th>3. ReAct Agent (Tool Calling)</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.boundary}>
                <td className="font-medium">{r.boundary}</td>
                <td className="font-mono text-[var(--dr-det)]">{r.composed}</td>
                <td className="font-mono text-[var(--dr-llm)]">{r.direct}</td>
                <td className="font-mono text-[var(--dr-llm)]">{r.react}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col gap-1 text-xs text-base-content/60">
        <p>
          <b>Decision Router</b>: LLM semantic interpretation → explicit route → verified facts → Jev typed judgment →
          LLM response composition, with fail-closed halts at each boundary.
        </p>
        <p>
          <b>Direct LLM + Structured Output</b>: one LLM call with verified facts injected inline → structured JSON
          decision → writes the response. No type check, no halt path.
        </p>
        <p>
          <b>ReAct Agent</b>: LLM → tool call to retrieve the record → LLM chooses actions → JSON decision + writes the
          response. Judgment is fully in the loop.
        </p>
      </div>
    </section>
  )
}