/** Severity tiers. `info` never triggers any action in any policy mode. */
export type Severity = 'critical' | 'high' | 'medium' | 'info'

/**
 * One detected span. Positions index `content`; the report never carries the
 * original matched text — only the span and a 4-char tail for correlation.
 */
export interface Finding {
  ruleId: string
  type: string
  severity: Severity
  start: number
  end: number
  /** Last 4 chars of the matched span, for human correlation only. */
  sampleLast4: string
  /** Fingerprint source label, e.g. `DEEPSEEK_API_KEY(file)`. Absent for pattern findings. */
  source?: string
}

/** Engine input. `file` inputs are pre-classified as text by the caller. */
export interface ScanInput {
  kind: 'text' | 'file'
  content: string
  name?: string
}

export interface ScanReport {
  findings: Finding[]
  truncated: boolean
  durationMs: number
}

/** One known credential value for fingerprint matching. */
export interface KnownCredential {
  ref: string
  source: string
  value: string
}

export interface ScanOptions {
  /** Known credential values from the local credentials provider. */
  known?: KnownCredential[]
  /** Per-input scan ceiling in UTF-16 code units. Default 1_000_000. */
  maxBytes?: number
  /** Entropy pass toggle. Findings are always `info` and never acted on. Default true. */
  entropy?: boolean
}
