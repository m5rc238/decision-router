import { useEffect, useState } from 'react'
import { SCENARIOS, findScenario } from './data/scenarios'
import { ComposedPane } from './components/ComposedPane'
import { BaselinePane } from './components/BaselinePane'
import { AuthorityBoundaries } from './components/AuthorityBoundaries'
import { BenchmarkPane } from './components/BenchmarkPane'
import { baselineForScenario } from './components/fixtures'
import { runLivePipeline, fetchStatus } from './lib/live/pipeline'
import { goldForScenario } from './lib/live/gold'
import type { LiveRun } from './lib/live/types'

interface BackendStatus {
  llm: { ok: boolean; modelID: string; providerID: string; url: string; reason?: string; reachableStatus?: number }
  jev: { ok: boolean; keyPresent: boolean; url: string }
}

export default function App() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const scenario = findScenario(scenarioId)

  const [live, setLive] = useState<LiveRun | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'finished'>('idle')
  const [status, setStatus] = useState<BackendStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void fetchStatus()
        .then((s) => {
          if (!cancelled) setStatus(s as BackendStatus)
        })
        .catch(() => {
          if (!cancelled) setStatus(null)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const running = phase === 'running'
  const liveMatches = live != null && live.scenarioId === scenario.id
  const completed = phase === 'finished' && liveMatches

  // Baseline pane reveals on the same real timeline; its content is a labeled
  // illustrative mock (it is never executed).
  const baselineActive = liveMatches ? live.stages.filter((s) => s.status !== 'idle').length : 0

  const handleRun = () => {
    if (running) return
    const captured = scenario
    setPhase('running')
    void runLivePipeline({
      scenario: captured,
      onUpdate: (run) => {
        if (findScenario(run.scenarioId).id === captured.id) setLive(run)
      },
    }).then((run) => {
      if (findScenario(run.scenarioId).id === captured.id) {
        setLive(run)
        setPhase('finished')
      }
    })
  }

  const handleScenarioChange = (id: string) => {
    if (running) return
    setScenarioId(id)
    setLive(null)
    setPhase('idle')
  }

  const { refunds, failures } = SCENARIOS.reduce<{ refunds: typeof SCENARIOS; failures: typeof SCENARIOS }>(
    (acc, s) => {
      if (s.group === 'refund') acc.refunds.push(s)
      else acc.failures.push(s)
      return acc
    },
    { refunds: [], failures: [] },
  )

  const baselineFixture = baselineForScenario(scenario)
  const gold = goldForScenario(scenario)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Decision Router</h1>
        </div>

        <p className="max-w-3xl text-sm text-base-content/70">
          The same customer-support case under two architectures. Composed: an LLM interprets the request into a route,
          verified facts steer a bounded Jev judgment, and a final LLM only translates that decision into prose. This
          side runs <span className="font-semibold">live</span> — big-pickle (Semantic Router, Response Composer) and the
          real Jev Decision API (judgment). The RAG + Agent pattern stays an illustrative mock for comparison.
        </p>
      </header>

      <section className="card border border-base-300 bg-base-100 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-base-content/60" htmlFor="scenario">
              Scenario
            </label>
            <span className="text-xs text-base-content/60">
              Real pipeline executes on Run. Fault scenarios inject bad output at one stage to show the real failure
              branches.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`badge badge-sm gap-1 ${status?.llm.ok ? 'badge-success' : 'badge-error'}`}
                title={`${status?.llm.url ?? 'unreachable'}${status?.llm.reason ? ` — ${status.llm.reason}` : ''}`}
              >
                {status?.llm.ok ? 'big-pickle connected' : 'big-pickle offline'}
              </span>
              <span
                className={`badge badge-sm gap-1 ${status?.jev.ok ? 'badge-success' : 'badge-warning'}`}
                title={status?.jev.ok ? status.jev.url : 'JEV_API_KEY missing — get one to run the real judge'}
              >
                {status?.jev.ok ? 'Jev connected' : 'Jev: needs JEV_API_KEY'}
              </span>
            </div>
            {running && (
              <span className="font-mono text-[11px] text-base-content/50">
                {live ? live.stages.filter((s) => s.status !== 'idle').length : 0} / 8 stages
              </span>
            )}
            <select
              id="scenario"
              className="select select-bordered select-sm w-full sm:w-80"
              value={scenario.id}
              onChange={(e) => handleScenarioChange(e.target.value)}
            >
              <optgroup label="Refund cases — real execution">
                {refunds.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Failure injection — demo">
                {failures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              type="button"
              disabled={running}
              onClick={handleRun}
              className="btn btn-primary btn-sm w-20 disabled:opacity-70"
            >
              {running ? '…' : liveMatches || phase === 'finished' ? 'Replay' : 'Run'}
            </button>
          </div>
        </div>
      </section>

      <BenchmarkPane gold={gold} />

      <main className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ComposedPane scenario={scenario} live={live} running={running} completed={completed} gold={gold} />
        <BaselinePane
          baseline={baselineFixture}
          active={baselineActive}
          running={running}
          completed={completed}
          gold={gold}
        />
      </main>

      <AuthorityBoundaries />
    </div>
  )
}