import type { Cost } from '../types'

export function CostSummary({ cost, label }: { cost: Cost; label: string }) {
  const rows: [string, string | number][] = [
    ['Deterministic ops', cost.deterministicOps],
    ['Jev judgments', cost.jevCalls],
    ['LLM calls', cost.llmCalls],
    ['LLM tokens', cost.llmTokens],
  ]
  return (
    <section
      aria-label={label}
      className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-base-300 pt-3"
    >
      <h4 className="w-full text-[10px] font-bold uppercase tracking-wider text-base-content/50">{label}</h4>
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-24 flex-col">
          <dt className="text-[10px] uppercase tracking-wider text-base-content/50">{k}</dt>
          <dd className="font-mono text-base font-bold">{v}</dd>
        </div>
      ))}
    </section>
  )
}