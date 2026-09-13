import type { Finding } from './types.js'

/** Shannon entropy over the characters of `s`, in bits per char. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let h = 0
  for (const count of freq.values()) {
    const p = count / s.length
    h -= p * Math.log2(p)
  }
  return h
}

const TOKEN_RE = /[A-Za-z0-9_-]{20,}/g
const ENTROPY_THRESHOLD = 3.6

/**
 * Low-confidence pass: token-shaped runs above the entropy threshold.
 * Findings are always `info` — policy layers must never act on them.
 */
export function scanEntropy(text: string): Finding[] {
  const findings: Finding[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    if (shannonEntropy(m[0]) >= ENTROPY_THRESHOLD) {
      const start = m.index
      findings.push({
        ruleId: 'high-entropy', type: 'high-entropy', severity: 'info',
        start, end: start + m[0].length, sampleLast4: m[0].slice(-4),
      })
    }
  }
  return findings
}
