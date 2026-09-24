const ROWS: { boundary: string; composed: string; rag: string }[] = [
  { boundary: 'Evidence explicit', composed: '✓', rag: 'implicit' },
  { boundary: 'Semantic route', composed: 'explicit', rag: 'implicit' },
  { boundary: 'Decision typed', composed: '✓', rag: '—' },
  { boundary: 'Judgment authority', composed: 'Jev', rag: 'LLM' },
  { boundary: 'LLM selects the action', composed: 'No', rag: 'Yes' },
  { boundary: 'LLM role in response', composed: 'translates only', rag: 'decides + writes' },
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
              <th>Composed</th>
              <th>RAG + Agent</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.boundary}>
                <td className="font-medium">{r.boundary}</td>
                <td className="font-mono text-[var(--dr-det)]">{r.composed}</td>
                <td className="font-mono text-[var(--dr-llm)]">{r.rag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col gap-1 text-xs text-base-content/60">
        <p>
          <b>Composed</b>: LLM semantic interpretation → explicit route → verified facts → Jev typed judgment →
          LLM response composition.
        </p>
        <p>
          <b>RAG + Agent</b>: LLM → retrieval → LLM judgment → response.
        </p>
      </div>
    </section>
  )
}