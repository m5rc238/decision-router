import type { TraceStep } from '../types'
import { LAYER_CLASS, LAYER_COLOR, LAYER_META } from './LayerMeta'
import { pct } from './format'

export function TraceList({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="flex flex-col pt-1">
      {steps.map((s, i) => (
        <li key={s.id} className="flex gap-3">
          <div className="flex w-4 flex-col items-center">
            <span className="mt-4 size-3 flex-none rounded-full" style={{ background: LAYER_COLOR[s.layer] }} />
            {i < steps.length - 1 && (
              <span className="my-1 w-0.5 flex-1 rounded" style={{ background: LAYER_COLOR[s.layer] }} />
            )}
          </div>
          <div className="min-w-0 flex-1 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`badge badge-sm ${LAYER_CLASS[s.layer]}`}>{LAYER_META[s.layer].label}</span>
              <span className="text-sm font-semibold">{s.title}</span>
            </div>
            {s.detail && <p className="mt-1 text-xs leading-relaxed text-base-content/60">{s.detail}</p>}
            {s.distribution && <ProbabilityBars distribution={s.distribution} confidence={s.confidence} />}
            {s.chips && s.chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.chips.map((c) => (
                  <span key={c} className="badge badge-ghost font-mono text-[10px] text-base-content/60">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function ProbabilityBars({
  distribution,
  confidence,
}: {
  distribution: { candidate: string; probability: number }[]
  confidence?: number
}) {
  const max = Math.max(...distribution.map((d) => d.probability))
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-[var(--dr-jev-bg)] p-3">
      {distribution.map((d) => {
        const top = d.probability === max
        return (
          <div key={d.candidate} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-2">
            <span
              className={`truncate font-mono text-[11px] ${top ? 'font-bold text-[var(--dr-jev)]' : 'text-base-content/60'}`}
            >
              {d.candidate} {top && '←'}
            </span>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--dr-jev)]/15">
              <div
                className="h-full rounded-full bg-[var(--dr-jev)] transition-all duration-500"
                style={{ width: `${Math.round(d.probability * 100)}%` }}
              />
            </div>
            <span className="text-right font-mono text-[11px]">{pct(d.probability)}</span>
          </div>
        )
      })}
      {confidence !== undefined && (
        <div className="mt-1.5 font-mono text-[11px] text-base-content/60">confidence {pct(confidence)}</div>
      )}
    </div>
  )
}