// Client for the live baseline panes. The Gemini call happens server-side
// (/api/live/baseline) so the API key never reaches the browser; the UI only
// sends the scenario payload and receives the recorded run.

import type { Scenario } from './types'

export interface BaselineOutcomeData {
  decision: string | null
  reasonCode: string | null
}

export interface BaselineRunData {
  outcome: BaselineOutcomeData
  text: string
  ms: number
  tokensIn: number
  tokensOut: number
  actions: string[]
  error?: string
}

export async function runBaselineClient(pipeline: 'cot' | 'react', scenario: Scenario): Promise<BaselineRunData> {
  const res = await fetch('/api/live/baseline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipeline, scenario }),
  })
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string }
  } | null
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `baseline ${pipeline} failed (HTTP ${res.status})`)
  }
  return json as BaselineRunData
}