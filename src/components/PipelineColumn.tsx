import type { PipelineResult } from '../types'
import { TraceList } from './TraceList'
import { CostSummary } from './CostSummary'
import { money } from './format'

export function PipelineColumn({ result }: { result: PipelineResult }) {
  const isComposed = result.mode === 'composed'
  return (
    <section className="card min-w-0 border border-base-300 bg-base-100 p-5">
      <header className="mb-4">
        <h2 className="text-lg font-bold tracking-tight">{isComposed ? 'Composed system' : 'LLM-only'}</h2>
        <p className="text-xs text-base-content/60">
          {isComposed
            ? 'deterministic ops → Jev judgment → deterministic action → LLM for prose only'
            : 'one model handles interpretation, retrieval decisions, math, policy & prose'}
        </p>
      </header>

      {result.action && (
        <div
          className={`alert mb-3 flex flex-wrap items-center gap-2 py-2.5 ${
            result.action.status === 'review' ? 'alert-warning' : 'alert-success'
          }`}
        >
          <span className="badge badge-sm badge-ghost font-bold uppercase tracking-wide">
            {result.action.type}
          </span>
          <span className="text-xs">{result.action.summary}</span>
          {result.action.id && <code className="font-mono text-[11px]">{result.action.id}</code>}
          {result.action.amount !== undefined && (
            <strong className="ml-auto font-mono text-base">{money(result.action.amount)}</strong>
          )}
        </div>
      )}

      <TraceList steps={result.steps} />

      <div className="mt-1 rounded-[10px] border border-base-300 border-l-4 border-l-[var(--dr-llm)] bg-[var(--dr-llm-bg)] p-3.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--dr-llm)]">
          Final answer {isComposed ? '(LLM)' : '(LLM monolith)'}
        </span>
        <p className="mt-1.5 text-[13px] leading-relaxed">{result.response}</p>
      </div>

      <CostSummary cost={result.cost} label="Operational cost" />
    </section>
  )
}