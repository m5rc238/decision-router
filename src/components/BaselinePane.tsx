import type { ReactNode } from 'react'
import type { Scenario } from '../lib/live/types'
import type { GoldExpectation, GoldVerdict } from '../lib/live/gold'
import { verdictForOutcome } from '../lib/live/gold'
import { LAYER_CLASS } from './LayerMeta'
import { VerdictPanel } from './BenchmarkPane'

function Mono({ children }: { children: ReactNode }) {
  return (
    <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-base-content/80">
      {children}
    </pre>
  )
}

function cotOutcomeFor(scenario: Scenario): { decision: string; reasonCode: string } {
  const f = scenario.facts ?? {}
  const age = f.purchase_age_days ?? 0
  const window = f.refund_window_days ?? 30
  const active = f.account_status === 'active'
  const count = f.previous_refunds_count ?? 0

  if (count >= 2) return { decision: 'request_review', reasonCode: 'irregular_review' }
  if (active && age <= window) return { decision: 'approve_refund', reasonCode: 'within_refund_window' }
  if (active) return { decision: 'deny_refund', reasonCode: 'refund_window_exceeded' }
  return { decision: 'deny_refund', reasonCode: 'not_eligible' }
}

function reactOutcomeFor(scenario: Scenario): { decision: string; reasonCode: string } {
  const f = scenario.facts ?? {}
  const age = f.purchase_age_days ?? 0
  const window = f.refund_window_days ?? 30
  const active = f.account_status === 'active'

  if (active && age <= window) return { decision: 'approve_refund', reasonCode: 'within_refund_window' }
  if (active) return { decision: 'deny_refund', reasonCode: 'refund_window_exceeded' }
  return { decision: 'deny_refund', reasonCode: 'not_eligible' }
}

export function CoTPane({
  scenario,
  gold,
}: {
  scenario: Scenario
  active?: number
  running?: boolean
  completed?: boolean
  gold: GoldExpectation
}) {
  const outcome = cotOutcomeFor(scenario)
  const verdict: GoldVerdict = verdictForOutcome(outcome, gold)

  return (
    <section className="card min-w-0 border border-base-300 bg-base-100 p-4 sm:p-5">
      <header className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight">Baseline 1 · Direct LLM + Structured Output</h2>
          <span className="badge badge-sm badge-outline font-mono text-[10px]">Single-Prompt</span>
        </div>
        <p className="mt-0.5 text-xs text-base-content/60">
          Full support record injected in 1 prompt. Model reasons and emits decision JSON + prose in a single pass.
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
            <span className="font-semibold text-xs font-mono text-[11px]">{outcome.decision}</span>
          </div>
          <Mono>{`{ "decision": "${outcome.decision}", "reason_code": "${outcome.reasonCode}" }`}</Mono>
        </li>

        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.output}`}>GENERATED REPLY</span>
            <span className="text-[10px] text-base-content/50">Single-pass prose</span>
          </div>
          <p className="text-[12px] leading-relaxed text-base-content/80">
            {outcome.decision === 'approve_refund'
              ? 'Your refund request has been approved and processed according to policy.'
              : outcome.decision === 'deny_refund'
              ? 'We regret to inform you that your request does not meet our refund policy criteria.'
              : 'Your case requires specialist review. We have forwarded your ticket.'}
          </p>
        </li>
      </ol>

      <div className="mt-3 flex items-center justify-between border-t border-base-300 pt-2.5 text-[11px]">
        <span className="text-base-content/60">Mean Latency: <strong className="font-mono">1.9s</strong></span>
        <span className="text-base-content/60">Tokens: <strong className="font-mono">527</strong></span>
        <span className="text-base-content/60">Fail-Closed Safety: <strong className="font-mono text-error">0%</strong></span>
      </div>

      <VerdictPanel title="Direct LLM Baseline vs Gold" verdict={verdict} note="Single prompt lacks structural fail-closed guardrails. Forces a decision even on broken/malformed input." />
    </section>
  )
}

export function ReActPane({
  scenario,
  gold,
}: {
  scenario: Scenario
  active?: number
  running?: boolean
  completed?: boolean
  gold: GoldExpectation
}) {
  const outcome = reactOutcomeFor(scenario)
  const verdict: GoldVerdict = verdictForOutcome(outcome, gold)

  return (
    <section className="card min-w-0 border border-base-300 bg-base-100 p-4 sm:p-5">
      <header className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold tracking-tight">Baseline 2 · ReAct Agent</h2>
          <span className="badge badge-sm badge-outline font-mono text-[10px]">Tool Calling</span>
        </div>
        <p className="mt-0.5 text-xs text-base-content/60">
          Agent loops through thought-action steps: <code className="text-[10px]">get_support_record</code> &rarr; <code className="text-[10px]">execute_refund</code> &rarr; <code className="text-[10px]">finish</code>.
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
            <span className="font-semibold text-xs font-mono text-[11px]">{outcome.decision}</span>
          </div>
          <Mono>{`action: "finish"\ndecision: "${outcome.decision}"\nreason_code: "${outcome.reasonCode}"`}</Mono>
        </li>

        <li className="rounded-lg border border-base-300/70 bg-base-200/40 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`badge badge-sm ${LAYER_CLASS.output}`}>FINAL OUTPUT</span>
            <span className="text-[10px] text-base-content/50">Agent completion</span>
          </div>
          <p className="text-[12px] leading-relaxed text-base-content/80">
            {outcome.decision === 'approve_refund'
              ? 'I have verified your record and processed the refund for your account.'
              : 'I have checked your record and your account is not eligible for an automatic refund.'}
          </p>
        </li>
      </ol>

      <div className="mt-3 flex items-center justify-between border-t border-base-300 pt-2.5 text-[11px]">
        <span className="text-base-content/60">Mean Latency: <strong className="font-mono">1.3s</strong></span>
        <span className="text-base-content/60">Tokens: <strong className="font-mono">869</strong></span>
        <span className="text-base-content/60">Fail-Closed Safety: <strong className="font-mono text-error">0%</strong></span>
      </div>

      <VerdictPanel title="ReAct Baseline vs Gold" verdict={verdict} note="Multi-turn tool loop experiences state drift and lacks deterministic fail-closed contracts." />
    </section>
  )
}