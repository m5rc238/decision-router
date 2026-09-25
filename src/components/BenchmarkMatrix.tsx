// The static 3-pipeline empirical matrix (20-scenario eval). Shared by the demo
// page and the dedicated results (#/results) page.

export function BenchmarkMatrix() {
  return (
    <section className="card border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300/60 pb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">
            Empirical Benchmark Matrix · 3-Pipeline Head-to-Head (20 Scenarios)
          </h2>
          <p className="text-xs text-base-content/70">
            Evaluated across routine refunds, exact day 30/31 boundaries, risk escalations, and system fault injections.
          </p>
        </div>
        <span className="badge badge-primary badge-sm font-mono text-[10px]">Empirical</span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="table table-xs w-full font-mono text-[11.5px]">
          <thead>
            <tr className="text-base-content/60 border-b border-base-300">
              <th>Architecture Pattern</th>
              <th className="text-center">Domain Decision Acc</th>
              <th className="text-center">Fail-Closed Safety</th>
              <th className="text-center">Overall Accuracy</th>
              <th className="text-center">Fabricated Values</th>
              <th className="text-right">Mean Latency</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-primary/10 font-bold">
              <td className="font-sans font-semibold text-primary">1. Decision Router (Composed)</td>
              <td className="text-center text-success">86.7% (13/15)</td>
              <td className="text-center text-success">100.0% (5/5)</td>
              <td className="text-center text-success">90.0% (18/20)</td>
              <td className="text-center">0</td>
              <td className="text-right">4.9 s</td>
            </tr>
            <tr>
              <td className="font-sans font-medium">2. Direct LLM + Structured Output</td>
              <td className="text-center">86.7% (13/15)</td>
              <td className="text-center text-error">0.0% (0/5)</td>
              <td className="text-center">65.0% (13/20)</td>
              <td className="text-center">0</td>
              <td className="text-right">1.9 s</td>
            </tr>
            <tr>
              <td className="font-sans font-medium">3. ReAct Agent (Tool Calling)</td>
              <td className="text-center text-error">60.0% (9/15)</td>
              <td className="text-center text-error">0.0% (0/5)</td>
              <td className="text-center text-error">45.0% (9/20)</td>
              <td className="text-center">0</td>
              <td className="text-right">1.3 s</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}