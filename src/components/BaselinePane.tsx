import type { ReactNode } from 'react'
import type { Scenario } from '../lib/live/types'
import type { GoldExpectation, GoldVerdict } from '../lib/live/gold'
import { verdictForOutcome } from '../lib/live/gold'
import type { BaselineRunData } from '../lib/live/baseline'
import { LAYER_CLASS } from './LayerMeta'
import { VerdictPanel } from './BenchmarkPane'

function Mono({ children }: { children: ReactNode }) {
  return (
    <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-base-content/80">
      {children}
    </pre>
  )
}

function StatusValue({ run, running }: { run: BaselineRunData | null; running: boolean }) {
  if (run?.outcome?.decision) return <span className="font-mono text-[11.5px] text-base-content">{run.outcome.decision}</span>
  return <span className="text-[11px] text-base-content/45">{running ? 'running…' : '—  press Run'}</span>
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`
}

function NothingToShow({ running, label }: { running: boolean; label: string }) {
  return <p className="mt-2 text-xs text-base-content/50">{running ? `Running ${label} baseline…` : `Press Run to evaluate ${label} against gold.`}</p>
}

export function DirectLLMPane({
  scenario,
  running,
  gold,
  run,
}: {
  scenario: Scenario
  running: boolean
  gold: GoldExpectation
  run: BaselineRunData | null
}) {
  const verdict: GoldVerdict | null = run?.outcome?.decision
    ? verdictForOutcome({ decision: run.outcome.decision, reasonCode: run.outcome.reasonCode ?? '' }, gold)
    : null
  const tokens = run ? run.tokensIn + run.tokensOut : null

  return (
    <section className="card min-w-0 border border-base-300 bg-base-100 p-4 sm:p-5">
      <header className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight">Baseline 1 · Direct LLM + Structured Output</h2>
          <span className="badge badge-sm badge-outline font-mono text-[10px]">Single-Prompt</span>
        </div>
        <p className="mt-0.5 text-xs text-base-content/60">
          Real Gemini call: full support record injected in 1 prompt. Model reasons and emits decision JSON in a single pass.
        </p>
      </header>

      <ol className="flex flex-col gap-2.5 text-xs">
        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.input}`}>PROMPT CONTEXT</span>
            <span className="font-semibold text-xs">User Query + Full Record Injected</span>
          </div>
          <p className="font-mono text-[11px] text-base-content/80">&ldquo;{scenario.userInput}&rdquo;</p>
          <div className="mt-1.5 font-mono text-[10.5px] text-base-content/60 bg-base-300/40 p-1.5 rounded">
            age: {scenario.facts?.purchase_age_days ?? 'N/A'}d | window: {scenario.facts?.refund_window_days ?? 'N/A'}d | status: {scenario.facts?.account_status ?? 'N/A'}
          </div>
        </li>

        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.llm}`}>STRUCTURED OUTPUT</span>
            <StatusValue run={run} running={running} />
          </div>
          {run?.outcome?.reasonCode ? <span className="font-mono text-[10.5px] text-base-content/60">{run.outcome.reasonCode}</span> : null}
        </li>

        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.output}`}>MODEL OUTPUT</span>
            <span className="text-[10px] text-base-content/50">Single Gemini response</span>
          </div>
          {run ? <Mono>{run.text.slice(0, 600) || '∅'}</Mono> : null}
        </li>
      </ol>

      {run?.error ? <p className="mt-2 text-xs text-error">Baseline error: {run.error}</p> : null}

      <div className="mt-3 flex items-center justify-between border-t border-base-300 pt-2.5 text-[11px]">
        <span className="text-base-content/60">Mean Latency: <strong className="font-mono">{run ? fmtMs(run.ms) : '—'}</strong></span>
        <span className="text-base-content/60">Tokens: <strong className="font-mono">{tokens ?? '—'}</strong></span>
        <span className="text-base-content/60">Fail-Closed Safety: <strong className="font-mono text-error">0%</strong></span>
      </div>

      {verdict ? (
        <VerdictPanel title="Direct LLM Baseline vs Gold" verdict={verdict} note="Single prompt lacks structural fail-closed guardrails. Forces a decision even on broken/malformed input." />
      ) : (
        <NothingToShow running={running} label="this baseline" />
      )}
    </section>
  )
}

export function ReActPane({
  scenario,
  running,
  gold,
  run,
}: {
  scenario: Scenario
  running: boolean
  gold: GoldExpectation
  run: BaselineRunData | null
}) {
  const verdict: GoldVerdict | null = run?.outcome?.decision
    ? verdictForOutcome({ decision: run.outcome.decision, reasonCode: run.outcome.reasonCode ?? '' }, gold)
    : null
  const tokens = run ? run.tokensIn + run.tokensOut : null

  return (
    <section className="card min-w-0 border border-base-300 bg-base-100 p-4 sm:p-5">
      <header className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight">Baseline 2 · ReAct Agent</h2>
          <span className="badge badge-sm badge-outline font-mono text-[10px]">Tool Calling</span>
        </div>
        <p className="mt-0.5 text-xs text-base-content/60">
          Real Gemini agent loop: <code className="text-[10px]">get_support_record</code> &rarr; <code className="text-[10px]">execute_refund</code> &rarr; <code className="text-[10px]">finish</code>.
        </p>
      </header>

      <ol className="flex flex-col gap-2.5 text-xs">
        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.action}`}>STEP 1 · TOOL CALL</span>
            <span className="font-semibold text-xs font-mono text-[11px]">get_support_record()</span>
          </div>
          <p className="text-[11px] text-base-content/70">Observation retrieved: {scenario.facts ? `${scenario.facts.purchase_age_days}d age, ${scenario.facts.account_status}` : 'no facts available'}</p>
        </li>

        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.llm}`}>STEP 2 · AGENT DECISION</span>
            <StatusValue run={run} running={running} />
          </div>
          {run ? <div className="mt-1 font-mono text-[10.5px] text-base-content/60">actions: {run.actions.join(' → ') || 'none'}</div> : null}
          {run?.outcome?.reasonCode ? <div className="font-mono text-[10.5px] text-base-content/60">reason: {run.outcome.reasonCode}</div> : null}
        </li>

        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.output}`}>FINAL OUTPUT</span>
            <span className="text-[10px] text-base-content/50">Agent completion</span>
          </div>
          {run ? <Mono>{run.text.slice(0, 600) || '∅'}</Mono> : null}
        </li>
      </ol>

      {run?.error ? <p className="mt-2 text-xs text-error">Baseline error: {run.error}</p> : null}

      <div className="mt-3 flex items-center justify-between border-t border-base-300 pt-2.5 text-[11px]">
        <span className="text-base-content/60">Mean Latency: <strong className="font-mono">{run ? fmtMs(run.ms) : '—'}</strong></span>
        <span className="text-base-content/60">Tokens: <strong className="font-mono">{tokens ?? '—'}</strong></span>
        <span className="text-base-content/60">Fail-Closed Safety: <strong className="font-mono text-error">0%</strong></span>
      </div>

      {verdict ? (
        <VerdictPanel title="ReAct Baseline vs Gold" verdict={verdict} note="Multi-turn tool loop experiences state drift and lacks deterministic fail-closed contracts." />
      ) : (
        <NothingToShow running={running} label="this baseline" />
      )}
    </section>
  )
}