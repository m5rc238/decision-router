// Scenario sources for the eval harness: the 11 live-app fixtures plus
// policy-boundary variants mined from the gold rules so the run covers the
// interesting edges (exact boundaries, inactive accounts, repeat-refund
// escalation) rather than only the happy path.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Scenario } from '../../src/lib/live/types'

const SCENARIO_DIR = join(process.cwd(), 'src/data/scenarios')

export function loadBaseScenarios(): Scenario[] {
  const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).sort()
  return files.map((f) => JSON.parse(readFileSync(resolve(SCENARIO_DIR, f), 'utf8')) as Scenario)
}

export function benchmarkScenarioSet(): Scenario[] {
  const extra: Scenario[] = [
    {
      id: 'edge-just-bought',
      label: 'Refund — bought today (approve)',
      group: 'refund',
      userInput:
        'I just bought the Pro plan an hour ago and changed my mind — can I cancel and get a refund?',
      facts: { purchase_age_days: 0, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
    },
    {
      id: 'edge-boundary-30-days',
      label: 'Refund — day 30 exact boundary (approve)',
      group: 'refund',
      userInput: 'Today is day 30 since purchase, I would like a refund please.',
      facts: { purchase_age_days: 30, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
    },
    {
      id: 'edge-boundary-31-days',
      label: 'Refund — day 31 exact boundary (deny)',
      group: 'refund',
      userInput: 'It has been 31 days since purchase, please refund my Pro plan.',
      facts: { purchase_age_days: 31, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
    },
    {
      id: 'edge-inactive-account',
      label: 'Refund — account suspended (deny·not eligible)',
      group: 'refund',
      userInput: 'I need a refund for my Pro plan, please.',
      facts: { purchase_age_days: 10, refund_window_days: 30, account_status: 'suspended', previous_refunds_count: 0 },
    },
    {
      id: 'edge-account-cancelled',
      label: 'Refund — account cancelled (deny·not eligible)',
      group: 'refund',
      userInput: 'My account was cancelled, can I get a refund for my last charge?',
      facts: { purchase_age_days: 15, refund_window_days: 30, account_status: 'cancelled', previous_refunds_count: 0 },
    },
    {
      id: 'edge-repeat-refunds',
      label: 'Refund — repeat refunds (review)',
      group: 'refund',
      userInput: 'Make me a refund again, Pro plan this time.',
      facts: { purchase_age_days: 10, refund_window_days: 30, account_status: 'active', previous_refunds_count: 3 },
    },
    {
      id: 'edge-repeat-out-window',
      label: 'Refund — repeat refunds + out of window (review)',
      group: 'refund',
      userInput: 'Please refund my Pro plan, I have been waiting weeks.',
      facts: { purchase_age_days: 200, refund_window_days: 30, account_status: 'active', previous_refunds_count: 3 },
    },
    {
      id: 'edge-chargeback-threat',
      label: 'Refund — chargeback threat + prior refunds (review)',
      group: 'refund',
      userInput: 'I will file a bank chargeback unless you process a refund immediately.',
      facts: { purchase_age_days: 12, refund_window_days: 30, account_status: 'active', previous_refunds_count: 2 },
    },
    {
      id: 'edge-conflicting-claims',
      label: 'Refund — user claims conflicting date (review)',
      group: 'refund',
      userInput: 'I bought this 2 months ago but my dashboard says 10 days ago, refund me!',
      facts: { purchase_age_days: 10, refund_window_days: 30, account_status: 'active', previous_refunds_count: 0 },
    },
  ]
  return [...loadBaseScenarios(), ...extra]
}