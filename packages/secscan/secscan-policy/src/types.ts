/**
 * Wire face for the secscan settings namespace and the findings push event.
 * Client-safe: no node imports, no runtime identity beyond the event contract.
 * The browser mirrors these shapes in its own bundle (client bundle purity
 * forbids cross-plugin value imports); this file is the single source the
 * host face compiles against.
 *
 * @module @deepseek-ai/dsh-secscan-policy/types
 */
import type {} from '@deepseek-ai/cordis'

/** Policy modes; `redact`/`block` shipped in P2. */
export const SECSCAN_MODES = ['off', 'monitor', 'redact', 'block'] as const
export type Mode = (typeof SECSCAN_MODES)[number]

/** One audit/push-safe finding projection: ruleId/type/severity/last4, never the text. */
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
  mode: Mode
  action: SecscanAction
  findings: SecscanFindingSummary[]
  at: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Egress scan surfaced findings in a batch (any non-off mode).
     * @param payload - session-scoped summary; JSON-safe, no matched text.
     * @mode emit
     */
    'secscan/findings'(payload: SecscanFindingsEvent): void
  }
}
