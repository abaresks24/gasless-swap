// Tiny .env loader for the node scripts (no secrets hardcoded in the repo).
import { readFileSync } from 'node:fs'

const text = readFileSync(new URL('../.env', import.meta.url), 'utf8')
export const env = Object.fromEntries(
  text
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

export function requireEnv(key) {
  const value = env[key]
  if (!value) throw new Error(`Missing ${key} in frontend/.env`)
  return value
}
