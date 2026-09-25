import { useEffect, useState } from 'react'
import { SCENARIOS, findScenario } from './data/scenarios'
import { ComposedPane } from './components/ComposedPane'
import { CoTPane, ReActPane } from './components/BaselinePane'
import { BenchmarkPane } from './components/BenchmarkPane'
import { ResultsPage } from './components/ResultsPage'
import { runLivePipeline, fetchStatus } from './lib/live/pipeline'
import { goldForScenario } from './lib/live/gold'
import { GITHUB_URL } from './config'
import type { LiveRun } from './lib/live/types'

interface BackendStatus {
  llm: { ok: boolean; modelID: string; providerID: string; url: string; reason?: string; reachableStatus?: number }
  jev: { ok: boolean; keyPresent: boolean; url: string }
}

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#\/?/, ''))
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const scenario = findScenario(scenarioId)

  const [live, setLive] = useState<LiveRun | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'finished'>('idle')
  const [status, setStatus] = useState<BackendStatus | null>(null)

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace(/^#\/?/, ''))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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

  const gold = goldForScenario(scenario)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300/70 pb-3">
        <a href="#/" className="text-xs font-semibold uppercase tracking-wider text-base-content/70 hover:text-primary">
          Decision Router
        </a>
        <div className="flex items-center gap-4">
          <a
            href="#/"
            className={`link text-xs ${route === '' ? 'link-primary font-semibold' : 'link-base-content/60'}`}
          >
            Demo
          </a>
          <a
            href="#results"
            className={`link text-xs ${route === 'results' ? 'link-primary font-semibold' : 'link-base-content/60'}`}
          >
            Results
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="link text-xs"
            title="GitHub repository"
            aria-label="GitHub repository"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
      </nav>

      {route === 'results' ? (
        <ResultsPage />
      ) : (
        <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Decision Router · Empirical Architecture Benchmark</h1>
        </div>

        <p className="max-w-4xl text-sm text-base-content/70">
          Comparing customer support automation across 3 production architectures: <span className="font-semibold text-primary">Decision Router</span> (Composed pipeline with typed contracts, verified facts & Jev judgment), <span className="font-semibold text-base-content/90">Direct LLM + Structured Output</span> (Single-prompt JSON model), and <span className="font-semibold text-base-content/90">ReAct Agent</span> (Multi-step tool calling loop).
        </p>
      </header>

      <section className="card border border-base-300 bg-base-100 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-base-content/60" htmlFor="scenario">
              Benchmark Scenario Selection
            </label>
            <span className="text-xs text-base-content/60">
              Select a scenario to evaluate all 3 architectures live. Fault scenarios test fail-closed safety.
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

      <main className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <ComposedPane scenario={scenario} live={live} running={running} completed={completed} gold={gold} />
        <CoTPane scenario={scenario} active={undefined} running={running} completed={completed} gold={gold} />
        <ReActPane scenario={scenario} active={undefined} running={running} completed={completed} gold={gold} />
      </main>
        </>
      )}
    </div>
  )
}