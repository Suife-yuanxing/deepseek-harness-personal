import type { Finding, KnownCredential } from './types.js'

const MIN_VALUE_LENGTH = 12

/**
 * Dedupe by value (first source wins — the winning layer per credentials-local
 * precedence) and drop short values that would match too widely.
 */
export function buildKnownCredentials(items: KnownCredential[]): KnownCredential[] {
  const byValue = new Map<string, KnownCredential>()
  for (const item of items) {
    if (item.value.length < MIN_VALUE_LENGTH) continue
    if (!byValue.has(item.value)) byValue.set(item.value, item)
  }
  return [...byValue.values()]
}

/** Exact substring match of known values — the user's real keys, 100% precision. */
export function scanKnownCredentials(text: string, known: KnownCredential[]): Finding[] {
  const findings: Finding[] = []
  for (const item of known) {
    let from = 0
    for (;;) {
      const start = text.indexOf(item.value, from)
      if (start < 0) break
      findings.push({
        ruleId: 'known-credential', type: 'known-credential', severity: 'critical',
        start, end: start + item.value.length, sampleLast4: item.value.slice(-4),
        source: `${item.ref}(${item.source})`,
      })
      from = start + item.value.length
    }
  }
  return findings
}
