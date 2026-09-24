// Small strict helpers for turning model output into typed contracts.
// The router/composer are LLMs: their output must be validated before any
// downstream stage trusts it.

export function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const src = fence ? fence[1] : text
  const start = src.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

export function stringify(value: unknown, spaces = 2): string {
  return JSON.stringify(value, null, spaces)
}

export function formatTokens(tokens: { input?: number; output?: number; total?: number } | undefined): string {
  if (!tokens) return ''
  const parts: string[] = []
  if (tokens.input !== undefined) parts.push(`${tokens.input} in`)
  if (tokens.output !== undefined) parts.push(`${tokens.output} out`)
  if (tokens.total !== undefined) parts.push(`${tokens.total} total`)
  return parts.join(' · ')
}