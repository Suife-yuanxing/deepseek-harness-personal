/**
 * Egress secret-scan policy. Subscribes `agent/pre-step` and scans the text of
 * each newly submitted message batch before it can leave the machine toward a
 * model API. P1 ships `off | monitor`: monitor records summarized findings to
 * a local audit and never blocks or rewrites. Engine failures fail open here
 * (monitor must not break the loop); the fingerprint source is the local
 * credentials provider's `resolveAll()` when it offers one.
 *
 * @module @deepseek-ai/dsh-secscan-policy
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { buildKnownCredentials, scan, type KnownCredential } from '@deepseek-ai/dsh-secscan'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
// Type-only side effects: the canonical event augmentations these listeners
// program against. No runtime dependency on either package.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-credentials'
import { createAudit, type Audit } from './audit.js'

export const name = 'secscan-policy'

/** Services this policy reads; the credentials provider is always composed in dsh-base. */
export const inject = ['credentials']

const MODES = ['off', 'monitor'] as const
export type Mode = (typeof MODES)[number]

/** Plugin config; every key optional with the defaults shown. */
export interface Config {
  /** Policy mode; defaults to `monitor`. `redact`/`block` are rejected until P2. */
  mode?: Mode
  /** Audit file override; defaults to `<dsh home>/secscan/audit.jsonl`. */
  auditFile?: string
  /** Per-batch scan ceiling in UTF-16 code units; defaults to the engine's 1 MB. */
  maxBytes?: number
  /** Audit ring size; defaults to 1000. */
  maxAudit?: number
  /** Test-only injection: make the engine throw to prove the fail-open path. */
  failScan?: boolean
}

interface TextBlock {
  type: string
  text?: string
}

interface BatchMessage {
  content: ReadonlyArray<TextBlock>
}

interface ResolvedCredentialValue {
  ref: string
  source: string
  value: string
}

interface CredentialsWithEnumeration {
  resolveAll?: () => Promise<ResolvedCredentialValue[]>
}

/** Text of every text block in the batch, newline-joined. */
function extractText(messages: ReadonlyArray<BatchMessage>): string {
  const parts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text) parts.push(block.text)
    }
  }
  return parts.join('\n')
}

/** Audit-safe finding projection: ruleId/type/severity/last4, never the text. */
function summarize(report: {
  findings: ReadonlyArray<{ ruleId: string; type: string; severity: string; sampleLast4: string; source?: string }>
}): Array<{ ruleId: string; type: string; severity: string; sampleLast4: string; source?: string }> {
  return report.findings.map(f => ({
    ruleId: f.ruleId,
    type: f.type,
    severity: f.severity,
    sampleLast4: f.sampleLast4,
    ...(f.source === undefined ? {} : { source: f.source }),
  }))
}

/** Register the pre-step egress gate. Mounts nothing in `off` mode. */
export function apply(ctx: Context, config: Config = {}): void {
  const mode = config.mode ?? 'monitor'
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new Error(`secscan-policy: mode "${mode}" is not available yet (off|monitor); redact/block land in P2`)
  }
  if (mode === 'off') return

  const audit: Audit = createAudit({
    file: config.auditFile ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'secscan', 'audit.jsonl'),
    ...(config.maxAudit === undefined ? {} : { max: config.maxAudit }),
  })

  let known: KnownCredential[] = []
  const credentials = ctx.credentials as unknown as CredentialsWithEnumeration | undefined
  const refreshKnown = async (): Promise<void> => {
    try {
      known = credentials?.resolveAll ? buildKnownCredentials(await credentials.resolveAll()) : []
    } catch {
      known = [] // fingerprints are an optimization, never a failure
    }
  }
  let knownReady: Promise<void> = refreshKnown()
  ctx.on('credentials/updated', () => {
    knownReady = refreshKnown()
  })

  ctx.on('agent/pre-step', async ({ messages }, next): Promise<PreStepDecision> => {
    await knownReady
    let report
    try {
      const text = extractText(messages)
      if (!text) return next()
      report = config.failScan
        ? (() => {
          throw new Error('injected scan failure')
        })()
        : scan(
          { kind: 'text', content: text },
          {
            known,
            entropy: true,
            ...(config.maxBytes === undefined ? {} : { maxBytes: config.maxBytes }),
          },
        )
    } catch {
      await audit.record({ egress: 'pre-step', mode, kind: 'scan-error' })
      return next() // fail-open in monitor: a broken engine must not break the loop
    }
    if (report.findings.length === 0) return next()
    await audit.record({
      egress: 'pre-step', mode, action: 'pass',
      findings: summarize(report), truncated: report.truncated,
    })
    return next() // monitor: observe only
  })
}
