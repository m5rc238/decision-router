import type { ReactNode } from 'react'
import type { GoldExpectation, GoldVerdict } from '../lib/live/gold'

function CheckRow({ check }: { check: GoldVerdict['checks'][number] }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span
        className={`font-mono text-[10px] font-bold ${check.ok ? 'text-success' : 'text-[var(--dr-fail)]'}`}
      >
        {check.ok ? '✓' : '✗'}
      </span>
      <span className="font-medium text-base-content/80">{check.name}</span>
      <span className="text-base-content/45">
        actual: <span className="font-mono">{check.actual ?? '—'}</span>
      </span>
      <span className="text-base-content/45">
        expected: <span className="font-mono">{check.expected}</span>
      </span>
    </li>
  )
}

export function VerdictPanel({
  title,
  verdict,
  note,
}: {
  title: string
  verdict: GoldVerdict
  note?: ReactNode
}) {
  return (
    <div
      className={`mt-3 rounded-lg border p-3 ${
        verdict.pass
          ? 'border-success/40 bg-success/5'
          : 'border-[var(--dr-fail)]/40 bg-[var(--dr-fail-bg)]/60'
      }`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-base-content/70">{title}</span>
        <span className={`badge badge-sm ${verdict.pass ? 'badge-success' : 'badge-error'}`}>
          {verdict.pass ? 'PASS' : 'MISMATCH'}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {verdict.checks.map((c) => (
          <CheckRow key={c.name} check={c} />
        ))}
      </ul>
      {note && <p className="mt-2 text-[11px] leading-relaxed text-base-content/55">{note}</p>}
    </div>
  )
}

function ReferenceStat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'info' }) {
  const toneClass =
    tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-warning' : tone === 'info' ? 'text-info' : 'text-base-content/80'
  return (
    <div className="rounded-lg border border-base-300/70 bg-base-200/40 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-base-content/50">{label}</dt>
      <dd className={`mt-0.5 font-mono text-[13px] font-semibold ${toneClass}`}>{value}</dd>
    </div>
  )
}

export function BenchmarkPane({ gold }: { gold: GoldExpectation }) {
  const halt = gold.expect === 'halt'
  const decisionTone = gold.decision === 'approve_refund' ? 'ok' : gold.decision === 'deny_refund' ? 'warn' : 'info'

  return (
    <div className="flex flex-col gap-4">
      {/* Current Scenario Gold Spec */}
      <section className="card border border-base-300 bg-base-100 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/70">
            Current Scenario · Gold Specification
          </h2>
          <span className="badge badge-sm badge-outline">spec-derived</span>
          <span className="ml-auto max-w-[45%] truncate text-right text-xs text-base-content/50" title={gold.label}>
            {gold.label}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-base-content/60">
          The ideal answer for this case, derived from the business rules baked into the fixtures — the same rule set the
          live judge is told.
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ReferenceStat label="Route" value={gold.route} tone="info" />
          <ReferenceStat
            label={halt ? 'Expected behavior' : 'Expected decision'}
            value={halt ? 'no decision — halt' : gold.decision}
            tone={halt ? 'warn' : decisionTone}
          />
          <ReferenceStat
            label={halt ? 'Halt at' : 'Expected reason'}
            value={halt ? gold.haltStage ?? 'human triage' : gold.reasonCode}
          />
        </dl>
        <p className="mt-2 text-xs leading-relaxed text-base-content/55">{gold.rule}</p>
      </section>
    </div>
  )
}