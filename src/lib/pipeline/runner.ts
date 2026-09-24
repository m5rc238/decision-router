// Wiring: which adapters the demo uses, plus runnable example inputs.
//
// This is the ONLY place to swap mock adapters for real ones. The pipeline
// never imports the concrete adapters — it receives them here.

import { mockJevAdapter } from '../adapters/jev/mockJevAdapter'
import { mockLlmAdapter } from '../adapters/llm/mockLlmAdapter'
import type { JevAdapter } from '../adapters/jev/types'
import type { LlmAdapter } from '../adapters/llm/types'
import { resetDemoState } from '../deterministic/actions'
import { runComposed } from './composed'
import { runLlmOnly } from './llmOnly'

export const adapters: { jev: JevAdapter; llm: LlmAdapter } = {
  jev: mockJevAdapter,
  llm: mockLlmAdapter,
}

export interface Example {
  label: string
  customerRef: string
  message: string
}

export const EXAMPLES: Example[] = [
  {
    label: 'Charged twice → refund',
    customerRef: 'CUST-1001',
    message: 'I want my money back because I was charged twice.',
  },
  {
    label: 'Billing question',
    customerRef: 'CUST-1002',
    message: 'Why did my bill go up this month?',
  },
  {
    label: 'Refund on flagged account → review',
    customerRef: 'CUST-1003',
    message: "I'd like a refund for last month — I never got the Pro features I paid for.",
  },
  {
    label: 'Technical issue',
    customerRef: 'CUST-1001',
    message: 'The invoice PDF export is broken in the portal.',
  },
]

export interface DemoRun {
  composed: Awaited<ReturnType<typeof runComposed>>
  llmOnly?: Awaited<ReturnType<typeof runLlmOnly>>
}

export async function runDemo(message: string, customerRef: string, withCompare: boolean): Promise<DemoRun> {
  resetDemoState()
  const { jev, llm } = adapters
  const composed = await runComposed({ message, customerRef, jev, llm })
  const llmOnly = withCompare ? await runLlmOnly({ message, customerRef, llm }) : undefined
  return { composed, llmOnly }
}

export { resetDemoState }