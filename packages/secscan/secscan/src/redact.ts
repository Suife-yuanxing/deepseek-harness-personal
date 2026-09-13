import type { Finding } from './types.js'

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 }

/**
 * Replace finding spans with `⟨REDACTED:<type>:…<last4⟩>` placeholders.
 * Spans are applied right-to-left; on overlap the higher severity is kept
 * (info findings never redact), so spans falling inside an already-redacted
 * region vanish.
 */
export function redactText(text: string, findings: Finding[]): string {
  const active = findings
    .filter(f => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER.medium)
    .sort((a, b) => b.start - a.start || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  let out = text
  let lastStart = Number.POSITIVE_INFINITY
  for (const f of active) {
    if (f.end > lastStart) continue // inside an already-redacted region
    out = out.slice(0, f.start) + `⟨REDACTED:${f.type}:…${f.sampleLast4}⟩` + out.slice(f.end)
    lastStart = f.start
  }
  return out
}
