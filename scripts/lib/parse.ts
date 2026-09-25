// Tolerant JSON extraction + CLI flag parsing for eval scripts.

export function extractJsonBlock(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

export function fmt(n: number): string | null {
  const v = Number.isNaN(n) ? null : n
  if (v === null) return null
  return Number.isInteger(v) ? String(v) : n.toFixed(1)
}

export interface CliArgs {
  pipelines: string[]
  ids: string[]
  repeat: number
  out: string
  liveBase?: string
  concurrency: number
  limit?: number
  quiet: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    pipelines: [],
    ids: [],
    repeat: 1,
    out: 'eval-results.json',
    concurrency: 1,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--pipelines':
        args.pipelines = (argv[++i] ?? '').split(',').filter(Boolean)
        break
      case '--ids':
        args.ids = (argv[++i] ?? '').split(',').filter(Boolean)
        break
      case '--repeat':
        args.repeat = Number(argv[++i])
        break
      case '--out':
        args.out = argv[++i] ?? 'eval-results.json'
        break
      case '--live-base':
        args.liveBase = argv[++i]
        break
      case '--concurrency':
        args.concurrency = Number(argv[++i]) || 2
        break
      case '--limit':
        args.limit = Number(argv[++i])
        break
      case '--quiet':
        args.quiet = true
        break
      default:
        if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`)
    }
  }
  return args
}