// Hallucination scanner for the eval: the scenario-facts domain carries NO
// monetary amounts and NO calendar dates. Any amount/date an LLM puts in its
// output is therefore fabricated — a strong, domain-appropriate signal.

const CURRENCY = /\$\s?\d+(?:\.\d{2})?(?:\s?(?:USD|usd|dollars?))?/g
const TEXT_DOLLAR = /\b\d+(?:\.\d{2})?\s?(?:dollars?|USD)\b/gi
// Absolute dates only (2024-, 24 Jan etc.) not relative ages ("30 days ago").
const DATE = /(?:\d{1,2}\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\S*\s+\d{1,2},?\s+\d{4}|\b\d{4}-\d{2}-\d{2}\b/gi
const DATE_NUM = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g

export function hasFabricatedValue(text: string | undefined): boolean {
  if (!text) return false
  CURRENCY.lastIndex = 0
  DATE.lastIndex = 0
  DATE_NUM.lastIndex = 0
  return CURRENCY.test(text) || TEXT_DOLLAR.test(text) || DATE.test(text) || DATE_NUM.test(text)
}