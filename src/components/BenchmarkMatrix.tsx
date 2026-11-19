// Offline-verified benchmark matrix (`grader-v2.0` + `results/offline-replay-bundle.v2.json`).
// Shared by the demo page and the dedicated results (#/results) page.

export function BenchmarkMatrix() {
  return (
    <section className="card border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300/60 pb-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">
            Verified Architecture Comparison · Offline Replay (grader-v2.0)
          </h2>
          <p className="text-xs text-base-content/70">
            Recomputed offline from saved workspace runs (<code>npm run replay</code>). Router v1 rows reflect the corrected v2 grader (3 flips, 10 unverifiable halt runs).
          </p>
        </div>
        <span className="badge badge-primary badge-sm font-mono text-[10px]">Verified Offline</span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="table table-xs w-full font-mono text-[11.5px]">
          <thead>
            <tr className="text-base-content/60 border-b border-base-300">
              <th>Architecture</th>
              <th className="text-center">Decide (Unique / Runs)</th>
              <th className="text-center">Shared Faults</th>
              <th className="text-center">Comp. Outage</th>
              <th className="text-center">Illustrative Cost/Run</th>
              <th className="text-right">Mean Latency</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-base-200/60">
              <td className="font-sans font-semibold">0. Deterministic Policy Rules (0 LLM, 0 Jev)</td>
              <td className="text-center text-success">13/15 (86.7%)</td>
              <td className="text-center text-success">4/4 (100%)</td>
              <td className="text-center text-base-content/50">n/a</td>
              <td className="text-center">1.33 (ref)</td>
              <td className="text-right">&lt;1 ms</td>
            </tr>
            <tr className="bg-primary/10">
              <td className="font-sans font-semibold text-primary">1. Decision Router (v1 re-scored)</td>
              <td className="text-center">21P / 7F / 2U (n=30)</td>
              <td className="text-center">2P / 0F / 6U (n=8)</td>
              <td className="text-center">0P / 2U (n=2)</td>
              <td className="text-center">1.03</td>
              <td className="text-right">9.9 s</td>
            </tr>
            <tr>
              <td className="font-sans font-medium">2. Direct-LLM + Validator (v2.1 · Gemini / Big Pickle)</td>
              <td className="text-center">13/15 · 65/75 (86.7%)</td>
              <td className="text-center text-success">4/4 (matched fault test)</td>
              <td className="text-center text-base-content/50">n/a (excl.)</td>
              <td className="text-center">1.33</td>
              <td className="text-right">2.0–2.2 s</td>
            </tr>
            <tr>
              <td className="font-sans font-medium">3. Direct-LLM (CoT · Gemini / Big Pickle)</td>
              <td className="text-center">13/15 · 65/75 (86.7%)</td>
              <td className="text-center text-error">0/4 (told &amp; not-told)</td>
              <td className="text-center text-base-content/50">n/a (excl.)</td>
              <td className="text-center">1.33</td>
              <td className="text-right">1.7–2.8 s</td>
            </tr>
            <tr>
              <td className="font-sans font-medium">4. ReAct Agent (Gemini / Big Pickle)</td>
              <td className="text-center">51/75 (68%) · 64/75 (85%)</td>
              <td className="text-center text-error">0/4 (told &amp; not-told)</td>
              <td className="text-center text-base-content/50">n/a (excl.)</td>
              <td className="text-center">0.76 · 0.99</td>
              <td className="text-right">3.7 s</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
