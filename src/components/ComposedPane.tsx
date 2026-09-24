import { type ReactNode } from 'react'
import type { Layer } from '../types'
import type { LiveRun, LiveStage, Scenario, StageKey } from '../lib/live/types'
import type { GoldExpectation } from '../lib/live/gold'
import { verdictForRun } from '../lib/live/gold'
import { formatTokens } from '../lib/live/json'
import { LAYER_CLASS, LAYER_COLOR } from './LayerMeta'
import { VerdictPanel } from './BenchmarkPane'

function Mono({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <pre
      className={`whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${
        dim ? 'text-base-content/55' : 'text-base-content/80'
      }`}
    >
      {children}
    </pre>
  )
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-base-content/60">
      <span className="size-3 animate-pulse rounded-full bg-primary/70" />
      <span className="font-mono">{label}</span>
    </div>
  )
}

function ErrorCard({ stage }: { stage: LiveStage }) {
  return (
    <div className="rounded-lg border border-[var(--dr-fail)]/50 bg-[var(--dr-fail-bg)] p-3 text-[11px] leading-relaxed">
      {stage.faulted && (
        <span className="mb-1.5 inline-block rounded bg-[var(--dr-fail)]/15 px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-[var(--dr-fail)]">
          demo fault injection
        </span>
      )}
      <p className="text-[var(--dr-fail)]">{stage.error}</p>
      {stage.output && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-base-content/40">
            Failure source
          </summary>
          <Mono dim>{stage.output}</Mono>
        </details>
      )}
    </div>
  )
}

function StageMeta({ stage }: { stage: LiveStage }) {
  if (stage.status !== 'done') return null
  const left: string[] = []
  if (stage.ms !== undefined) left.push(fmtMs(stage.ms))
  if (stage.tokens) left.push(formatTokens(stage.tokens))
  if (left.length === 0) return null
  return (
    <div className="mt-1.5 text-[10px] font-medium tabular-nums text-base-content/45">{left.join(' · ')}</div>
  )
}

interface StageSpec {
  key: StageKey
  tag: string
  layer: Layer
  title: string
  focus?: string
  authority?: string
  emphasized?: boolean
}

const STAGE_SPEC: StageSpec[] = [
  { key: 'user_input', tag: 'USER INPUT', layer: 'input', title: 'Customer message' },
  {
    key: 'semantic_router',
    tag: 'SEMANTIC ROUTER',
    layer: 'llm',
    title: 'Classify + extract',
    focus: 'LLM interpretation — a proposed route, not a decision.',
    authority: 'proposes a route · no business judgment',
  },
  {
    key: 'route_contract',
    tag: 'ROUTE CONTRACT',
    layer: 'deterministic',
    title: 'Structured hand-off',
    focus: 'The system now knows the route as typed data, not prose.',
  },
  {
    key: 'verified_facts',
    tag: 'PULL VERIFIED FACTS',
    layer: 'deterministic',
    title: 'Load system facts',
    focus: 'Local fixture standing in for DB / API — model memory is never used as fact.',
  },
  {
    key: 'jev_judgment',
    tag: 'JEV JUDGMENT ENGINE',
    layer: 'jev',
    title: 'Judge inside the decision space',
    focus: 'The central boundary — Jev produces the typed judgment, no prose.',
    authority: 'produces the typed judgment',
    emphasized: true,
  },
  {
    key: 'decision_contract',
    tag: 'DECISION CONTRACT',
    layer: 'deterministic',
    title: 'Bound the hand-off',
    focus: 'The response model receives a decision that already exists.',
  },
  {
    key: 'response_composer',
    tag: 'RESPONSE COMPOSER',
    layer: 'llm',
    title: 'Translate to prose',
    focus: 'The final LLM only writes the reply — it cannot change the decision.',
    authority: 'prose only · no decision authority',
  },
  {
    key: 'user_response',
    tag: 'USER RESPONSE',
    layer: 'output',
    title: 'Final message',
    focus: 'The translated decision reaches the user, unchanged.',
  },
]

function StageDetails({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
        <span className="mr-1 inline-block text-[10px] text-base-content/40 transition-transform group-open:rotate-90">
          ▸
        </span>
        {label}
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  )
}

function stageBody(stage: LiveStage, scenario: Scenario): ReactNode {
  switch (stage.key) {
    case 'user_input':
      return <Mono>{stage.output ?? scenario.userInput}</Mono>
    case 'semantic_router':
      return (
        <div className="flex flex-col gap-2">
          {stage.input && (
            <StageDetails label="Prompt · sent to big-pickle">
              <Mono dim>{stage.input}</Mono>
            </StageDetails>
          )}
          <Mono>{stage.output}</Mono>
        </div>
      )
    case 'verified_facts':
      return (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/45">
            System facts · local fixture (never model memory)
          </span>
          <Mono>{stage.output}</Mono>
        </div>
      )
    case 'jev_judgment':
      return (
        <div className="flex flex-col gap-2">
          {stage.input && (
            <StageDetails label="state + questions · sent to the Jev Decision API">
              <Mono dim>{stage.input}</Mono>
            </StageDetails>
          )}
          <Mono>{stage.output}</Mono>
        </div>
      )
    case 'decision_contract':
      return (
        <div className="flex flex-col gap-2">
          {stage.input && (
            <StageDetails label="judgment passed in">
              <Mono dim>{stage.input}</Mono>
            </StageDetails>
          )}
          <Mono>{stage.output}</Mono>
        </div>
      )
    case 'response_composer':
      return (
        <div className="flex flex-col gap-2">
          {stage.input && (
            <StageDetails label="Prompt · generated from the Decision contract">
              <Mono dim>{stage.input}</Mono>
            </StageDetails>
          )}
          <div className="rounded-[10px] border border-base-300 border-l-4 border-l-[var(--dr-llm)] bg-[var(--dr-llm-bg)] p-3.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--dr-llm)]">
              Composer output · big-pickle
            </span>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{stage.output}</p>
          </div>
        </div>
      )
    case 'user_response':
      return (
        <div className="rounded-[10px] border border-base-300 border-l-4 border-l-[var(--dr-ink)] bg-base-100 p-3.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">
            Final email · written by the Response Composer (big-pickle)
          </span>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] font-medium leading-relaxed">{stage.output}</p>
        </div>
      )
    default:
      return <Mono>{stage.output}</Mono>
  }
}

export function ComposedPane({
  scenario,
  live,
  completed,
  gold,
}: {
  scenario: Scenario
  live: LiveRun | null
  running: boolean
  completed: boolean
  gold: GoldExpectation
}) {
  const showAll = live != null

  const decisionStage = live?.stages.find((s) => s.key === 'decision_contract')?.output
  const decisionLine = decisionStage ? (JSON.parse(decisionStage) as { decision?: string }).decision : null

  const routerStage = live?.stages.find((s) => s.key === 'semantic_router')
  const composerStage = live?.stages.find((s) => s.key === 'response_composer')
  const jevStage = live?.stages.find((s) => s.key === 'jev_judgment')

  return (
    <section className="card min-w-0 border border-base-300 bg-base-100 p-5">
      <header className="mb-4">
        <h2 className="text-lg font-bold tracking-tight">Composed system</h2>
        <p className="mt-0.5 text-xs text-base-content/60">
          An LLM interprets the request, a route contract steers it to verified facts, Jev issues a bounded typed
          judgment, and a final LLM only translates that decision into prose. <span className="font-semibold">Runs live</span> on
          big-pickle + Jev.
        </p>
      </header>

      <ol className="flex flex-col">
        {STAGE_SPEC.map((spec, i) => {
          const liveStage = live?.stages[i]
          if (!showAll && i > 0) return null
          if (showAll && liveStage && liveStage.status === 'idle') {
            // Tail stages that were never reached stay hidden.
            return null
          }
          const isRunningNow = showAll && liveStage?.status === 'running'
          return (
            <li
              key={spec.key}
              className={isRunningNow ? 'rounded-lg ring-1 ring-primary/40' : ''}
              style={{ opacity: showAll ? 1 : i === 0 ? 1 : 0.3, transition: 'opacity 250ms ease' }}
            >
              <div className="flex gap-3">
                <div className="flex w-7 flex-col items-center">
                  <span className="mt-4 size-3 flex-none rounded-full" style={{ background: LAYER_COLOR[spec.layer] }} />
                  {i < STAGE_SPEC.length - 1 && (
                    <span className="my-1 w-0.5 flex-1 rounded" style={{ background: LAYER_COLOR[spec.layer] }} />
                  )}
                </div>
                <div className="min-w-0 flex-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge badge-sm ${LAYER_CLASS[spec.layer]}`}>{spec.tag}</span>
                    <span className="text-sm font-semibold">{spec.title}</span>
                    {liveStage?.status === 'done' && liveStage.highlight && (
                      <span className="badge badge-sm badge-primary badge-outline font-mono">{liveStage.highlight}</span>
                    )}
                    {liveStage?.faulted && (
                      <span className="badge badge-sm font-normal text-[var(--dr-fail)]">injected fault</span>
                    )}
                    {spec.authority && (
                      <span className="badge badge-sm badge-ghost font-normal text-base-content/50">
                        {spec.authority}
                      </span>
                    )}
                  </div>

                  <div
                    className={`mt-2 rounded-lg border bg-base-200/40 p-3 ${
                      spec.emphasized ? 'border-l-2 border-l-[var(--dr-jev)] border-l-solid' : 'border-base-300/70'
                    }`}
                  >
                    {!showAll ? (
                      <Mono>{scenario.userInput}</Mono>
                    ) : liveStage?.status === 'running' ? (
                      <Spinner label={spec.key === 'jev_judgment' ? 'awaiting real Jev…' : 'awaiting big-pickle…'} />
                    ) : liveStage?.status === 'error' ? (
                      <ErrorCard stage={liveStage} />
                    ) : (
                      <div className="flex flex-col gap-2">
                        {stageBody(liveStage!, scenario)}
                        {spec.focus && <span className="text-[11px] italic text-base-content/50">{spec.focus}</span>}
                      </div>
                    )}
                  </div>
                  {showAll && <StageMeta stage={liveStage!} />}
                </div>
              </div>
              {i < STAGE_SPEC.length - 1 && showAll && live?.stages[i + 1]?.status !== 'idle' && (
                <div className="flex justify-center py-0.5 text-sm leading-none text-base-content/30">↓</div>
              )}
            </li>
          )
        })}
      </ol>

      {!showAll && (
        <div className="mt-2 rounded-lg border border-dashed border-base-300 bg-base-200/30 px-3 py-2.5 text-[11px] leading-relaxed text-base-content/50">
          Run to execute — the real pipeline runs in order, each stage revealing as it actually completes.
        </div>
      )}

      {showAll && live?.status === 'triage' && (
        <div className="mt-2 rounded-lg border-l-4 border-amber-500 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700">
          <span className="font-bold">HUMAN TRIAGE</span> — {live.note}
        </div>
      )}
      {showAll && live?.status === 'error' && (
        <div className="mt-2 rounded-lg border-l-4 border-[var(--dr-fail)] bg-[var(--dr-fail-bg)] p-3 text-xs leading-relaxed text-[var(--dr-fail)]">
          <span className="font-bold">PIPELINE HALTED</span> —{' '}
          {live.stages.find((s) => s.status === 'error')?.error ?? 'a stage failed. The run rest is never executed.'}
        </div>
      )}

      {completed && (
        <section className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-base-300 pt-3">
          <h4 className="w-full text-[10px] font-bold uppercase tracking-wider text-base-content/50">
            Run metrics — live execution
          </h4>
          <div className="flex min-w-24 flex-col">
            <dt className="text-[10px] uppercase tracking-wider text-base-content/50">Total latency</dt>
            <dd className="font-mono text-base font-bold">{fmtMs(live?.totalMs)}</dd>
          </div>
          <div className="flex min-w-28 flex-col">
            <dt className="text-[10px] uppercase tracking-wider text-base-content/50">Router tokens</dt>
            <dd className="font-mono text-base font-bold">{routerStage?.tokens?.total ?? '—'}</dd>
          </div>
          <div className="flex min-w-28 flex-col">
            <dt className="text-[10px] uppercase tracking-wider text-base-content/50">Composer tokens</dt>
            <dd className="font-mono text-base font-bold">{composerStage?.tokens?.total ?? '—'}</dd>
          </div>
          <div className="flex min-w-28 flex-col">
            <dt className="text-[10px] uppercase tracking-wider text-base-content/50">Jev calls</dt>
            <dd className="font-mono text-base font-bold">
              {jevStage && jevStage.status === 'done' ? `1 · ${fmtMs(jevStage.ms)}` : jevStage?.status === 'error' ? 'failed' : '0'}
            </dd>
          </div>
          {decisionLine && (
            <div className="flex min-w-24 flex-col">
              <dt className="text-[10px] uppercase tracking-wider text-base-content/50">Decision</dt>
              <dd className="font-mono text-base font-bold">{decisionLine}</dd>
            </div>
          )}
        </section>
      )}

      {completed && (
        <details className="group mt-2 rounded-lg border border-base-300 bg-base-100 p-3">
          <summary className="cursor-pointer list-none text-sm font-semibold marker:content-none">
            <span className="text-primary">
              {live?.status === 'error' ? 'What failed and where?' : live?.status === 'triage' ? 'Why triaged?' : 'Why this decision?'}
            </span>
            <span className="ml-2 inline-block text-xs text-base-content/50 transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="mt-2 grid gap-1.5 text-xs">
            {live?.stages
              .filter((s) => s.status === 'done' && s.highlight)
              .map((s) => (
                <div key={s.key} className="flex flex-wrap items-baseline gap-2">
                  <dt className="w-28 flex-none font-mono text-[10px] uppercase tracking-wider text-base-content/50">
                    {s.key.replaceAll('_', ' ')}
                  </dt>
                  <dd className="font-mono leading-relaxed text-base-content/80">{s.highlight}</dd>
                </div>
              ))}
            {live?.stages
              .filter((s) => s.status === 'error')
              .map((s) => (
                <div key={s.key} className="flex flex-wrap items-baseline gap-2">
                  <dt className="w-28 flex-none font-mono text-[10px] uppercase tracking-wider text-[var(--dr-fail)]">
                    {s.key.replaceAll('_', ' ')} error
                  </dt>
                  <dd className="font-mono leading-relaxed text-[var(--dr-fail)]">{s.error}</dd>
                </div>
              ))}
          </div>
        </details>
      )}

      {completed && (
        <details className="group mt-2 rounded-lg border border-dashed border-base-300 bg-base-200/30 p-3 text-xs">
          <summary className="cursor-pointer list-none font-semibold marker:content-none">
            <span className="text-base-content/60">Fail-closed exception paths</span>
            <span className="ml-2 inline-block text-xs text-base-content/50 transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <div>
              <Mono>SEMANTIC ROUTER → AMBIGUOUS / MALFORMED → HUMAN TRIAGE</Mono>
              <p className="mt-1 text-[11px] leading-relaxed text-base-content/60">
                The router never invents a route. Ambiguity or unparseable output routes to a human, not to a guessed
                decision.
              </p>
            </div>
            <div>
              <Mono>PULL VERIFIED FACTS → UNAVAILABLE / STALE → HUMAN REVIEW</Mono>
              <p className="mt-1 text-[11px] leading-relaxed text-base-content/60">
                Fail closed rather than let the model fill missing facts from memory.
              </p>
            </div>
            <div>
              <Mono>COMPOSER → CONTRADICTS THE CONTRACT → OUTPUT REJECTED</Mono>
              <p className="mt-1 text-[11px] leading-relaxed text-base-content/60">
                The prose guardrail rejects any final message that would change or soften the decision.
              </p>
            </div>
          </div>
        </details>
      )}

      {completed && live && (
        <VerdictPanel
          title="Your run vs gold"
          verdict={verdictForRun(live, gold)}
          note="Checked against the reference at the top: route, decision, reason code, and the composer guardrail. Any red row means the real run diverged from the spec."
        />
      )}
    </section>
  )
}