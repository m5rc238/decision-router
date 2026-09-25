// Tiny .env.local loader (no dotenv dependency). Populates process.env only
// for keys that are NOT already present, so shell env always wins.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadEnvLocal(): void {
  const file = join(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}