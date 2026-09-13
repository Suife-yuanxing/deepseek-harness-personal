import { scanEntropy } from './entropy.js'
import { scanKnownCredentials } from './fingerprint.js'
import { scanRules } from './rules.js'
import type { Finding, ScanInput, ScanOptions, ScanReport } from './types.js'

const DEFAULT_MAX = 1_000_000

/**
 * Light dedupe: drop only exact duplicates (same rule and span). Cross-rule
 * overlaps are preserved in the report — each rule view is informative — and
 * resolved where it matters, at action time (redaction, severity thresholds).
 */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  const out: Finding[] = []
  for (const f of findings) {
    const key = `${f.ruleId}\u0000${f.start}\u0000${f.end}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/** Full engine entry: ceiling-truncate, run all passes, merge, time it. */
export function scan(input: ScanInput, options: ScanOptions = {}): ScanReport {
  const started = performance.now()
  const max = options.maxBytes ?? DEFAULT_MAX
  const truncated = input.content.length > max
  const content = truncated ? input.content.slice(0, max) : input.content
  const findings: Finding[] = [...scanRules(content)]
  if (options.entropy !== false) findings.push(...scanEntropy(content))
  if (options.known?.length) findings.push(...scanKnownCredentials(content, options.known))
  return { findings: dedupe(findings), truncated, durationMs: performance.now() - started }
}
