/**
 * Mirror of the `secscan` settings wire face and the findings push payload.
 * Client bundle purity forbids cross-plugin value imports, so the browser
 * carries its own copy of these shapes; the host face of record is
 * `@deepseek-ai/dsh-secscan-policy/types` (type-checked against it through
 * the package's type-only import).
 */

/** Policy modes, mirroring the host `secscan` namespace schema. */
export const SECSCAN_MODES = ['off', 'monitor', 'redact', 'block'] as const
export type SecscanMode = (typeof SECSCAN_MODES)[number]

/** Settings namespace owned by the secscan-policy plugin. */
export const SECSCAN_SETTINGS_NAMESPACE = 'secscan'

/** Durable section the two settings rows read and write. */
export interface SecscanSettings {
  mode: SecscanMode
  ignoreRuleIds: string[]
}

/** Defaults when the user-settings document has no override. */
export const DEFAULT_SECSCAN_SETTINGS: SecscanSettings = { mode: 'monitor', ignoreRuleIds: [] }

/** One push-safe finding projection: never the matched text. */
export interface SecscanFindingSummary {
  ruleId: string
  type: string
  severity: string
  sampleLast4: string
  source?: string
}

/** What the policy did with a flagged batch. */
export type SecscanAction = 'pass' | 'redact' | 'allowed' | 'blocked'

/** Payload of `secscan/findings` — all JSON, secrets never included. */
export interface SecscanFindingsEvent {
  sessionId: string
  mode: SecscanMode
  action: SecscanAction
  findings: SecscanFindingSummary[]
  at: number
}
