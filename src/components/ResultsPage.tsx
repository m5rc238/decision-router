import { useState } from 'react'
import ste100Md from '../../docs/EVAL_REPORT_STE100.md?raw'
import standardMd from '../../docs/EVAL_REPORT_STANDARD.md?raw'
import { BenchmarkMatrix } from './BenchmarkMatrix'
import { AuthorityBoundaries } from './AuthorityBoundaries'
import { Markdown } from './Markdown'

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'copy' | 'copied'>('copy')
  return (
    <button
      type="button"
      className="btn btn-ghost btn-xs font-mono"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setState('copied')
          window.setTimeout(() => setState('copy'), 1500)
        })
      }}
    >
      {state === 'copy' ? 'copy markdown' : 'copied ✓'}
    </button>
  )
}

export function ResultsPage() {
  const [reportTab, setReportTab] = useState<'ste100' | 'standard'>('ste100')

  const currentMarkdown = reportTab === 'ste100' ? ste100Md : standardMd
  const currentFileName = reportTab === 'ste100' ? 'docs/EVAL_REPORT_STE100.md' : 'docs/EVAL_REPORT_STANDARD.md'

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight">Evaluation Results</h2>
          <span className="badge badge-primary badge-sm font-mono text-[10px]">120 Live Executions</span>
        </div>
        <p className="max-w-3xl text-sm text-base-content/70">
          Full results of the 20-scenario empirical benchmark comparing the Decision Router against Direct-LLM (CoT) and ReAct Agent baselines across decision accuracy, fail-closed safety, and token economics.
        </p>
      </header>

      {/* Aggregate Architecture Comparison Table */}
      <BenchmarkMatrix />

      {/* Authority Boundaries Visualization */}
      <AuthorityBoundaries />

      {/* Tabbed Report Comparison: ASD-STE100 vs Standard / Academic */}
      <section className="card border border-base-300 bg-base-100 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300/70 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/70">
                Evaluation Report & Analysis
              </h2>
              <span className="badge badge-sm badge-ghost font-mono text-[10px]">{currentFileName}</span>
            </div>
            <p className="text-xs text-base-content/55 mt-0.5">
              Compare the evaluation report in Controlled Technical English (ASD-STE100) and Academic Systems format.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Version Tabs */}
            <div className="join">
              <button
                type="button"
                onClick={() => setReportTab('ste100')}
                className={`join-item btn btn-xs sm:btn-sm ${
                  reportTab === 'ste100' ? 'btn-primary font-semibold' : 'btn-outline'
                }`}
              >
                ASD-STE100 Version
              </button>
              <button
                type="button"
                onClick={() => setReportTab('standard')}
                className={`join-item btn btn-xs sm:btn-sm ${
                  reportTab === 'standard' ? 'btn-primary font-semibold' : 'btn-outline'
                }`}
              >
                Academic / Standard Version
              </button>
            </div>

            <CopyButton text={currentMarkdown} />
          </div>
        </div>

        {/* Informational Banner per Active Tab */}
        <div className="mt-3">
          {reportTab === 'ste100' ? (
            <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs leading-relaxed text-base-content/80">
              <span className="font-bold text-info uppercase tracking-wider text-[10px]">
                Controlled Language Specification (ASD-STE100):
              </span>
              <p className="mt-1">
                This version adheres to the international <strong>ASD Simplified Technical English</strong> specification. 
                Sentences do not exceed 20 words. Grammatical constructions prioritize active voice, precise technical names, and zero ambiguous idioms for international engineering clarity.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-base-300 bg-base-200/50 p-3 text-xs leading-relaxed text-base-content/80">
              <span className="font-bold uppercase tracking-wider text-[10px] text-base-content/70">
                Academic & Systems Research Format:
              </span>
              <p className="mt-1">
                This version contains comprehensive theoretical analysis, Goodhart metric vulnerabilities, ReAct agent state drift dynamics, and architectural trade-off evaluations.
              </p>
            </div>
          )}
        </div>

        {/* Rendered Markdown Document */}
        <div className="mt-4 max-h-[700px] overflow-auto rounded-lg border border-base-300 bg-base-200/40 p-4 sm:p-6">
          <Markdown text={currentMarkdown} />
        </div>
      </section>

      <footer className="text-[11px] text-base-content/45">
        Results generated by the automated evaluation harness in <code>scripts/eval.ts</code>.
      </footer>
    </section>
  )
}