/**
 * Egress secret-scan policy. Subscribes `agent/pre-step` and scans the text of
 * each newly submitted message batch before it can leave the machine toward a
 * model API. P2 ships `off | monitor | redact | block`: monitor records
 * summarized findings to a local audit and never blocks or rewrites; redact
 * rewrites sensitive spans and enters the step with the redacted batch; block
 * fails closed pending the approval ask. Engine failures fail open in
 * monitor/redact and closed in block; the fingerprint source is the local
 * credentials provider's `resolveAll()` when it offers one.
 *
 * @module @deepseek-ai/dsh-secscan-policy
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  buildKnownCredentials, redactText, scan,
  type Finding, type KnownCredential, type ScanOptions,
} from '@deepseek-ai/dsh-secscan'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
// Type-only side effects: the canonical event augmentations these listeners
// program against. No runtime dependency on any of these packages; approval is
// consumed opportunistically (`ctx.get`) so a deployment without it fails closed.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-user-approval'
import { createAudit, type Audit } from './audit.js'
import { SECSCAN_MODES, type Mode, type SecscanAction, type SecscanFindingSummary, type SecscanFindingsEvent } from './types.js'

export { SECSCAN_MODES, type Mode, type SecscanAction, type SecscanFindingSummary, type SecscanFindingsEvent } from './types.js'

export const name = 'secscan-policy'

/** Services this policy reads; the credentials provider is always composed in dsh-base. */
export const inject = ['credentials']

/** Plugin config; every key optional with the defaults shown. */
export interface Config {
  /** Policy mode; defaults to `monitor`. */
  mode?: Mode
  /** Findings with these ruleIds are dropped before any action (settings-editable). */
  ignoreRuleIds?: string[]
  /** Audit file override; defaults to `<dsh home>/secscan/audit.jsonl`. */
  auditFile?: string
  /** Per-batch scan ceiling in UTF-16 code units; defaults to the engine's 1 MB. */
  maxBytes?: number
  /** Audit ring size; defaults to 1000. */
  maxAudit?: number
  /** Test-only injection: make the engine throw to prove the fail-open path. */
  failScan?: boolean
}

/** Durable settings section (`secscan` namespace); also validates the composition entry. */
export const Config: z<Config> = z.object({
  mode: z.union([...SECSCAN_MODES]).default('monitor'),
  ignoreRuleIds: z.array(z.string()).default([]),
  auditFile: z.string(),
  maxBytes: z.number(),
  maxAudit: z.number(),
  failScan: z.boolean(),
})

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

/** One scanned text block with its block-relative findings. */
interface ScannedBlock {
  messageIndex: number
  blockIndex: number
  findings: Finding[]
}

/** Scan every text block separately; findings stay block-relative so redaction can rewrite them. */
function scanBatch(
  messages: ReadonlyArray<BatchMessage>,
  options: ScanOptions,
): { blocks: ScannedBlock[]; all: Finding[]; truncated: boolean } {
  const blocks: ScannedBlock[] = []
  const all: Finding[] = []
  let truncated = false
  messages.forEach((message, messageIndex) => {
    message.content.forEach((block, blockIndex) => {
      if (block.type !== 'text' || !block.text) return
      const report = scan({ kind: 'text', content: block.text }, options)
      truncated = truncated || report.truncated
      if (report.findings.length === 0) return
      blocks.push({ messageIndex, blockIndex, findings: report.findings })
      all.push(...report.findings)
    })
  })
  return { blocks, all, truncated }
}

/** Rewrite the flagged text blocks; untouched blocks keep object identity. */
function rewriteBatch(messages: readonly UserMessage[], blocks: ScannedBlock[]): UserMessage[] {
  const byMessage = new Map<number, ScannedBlock[]>()
  for (const b of blocks) {
    const list = byMessage.get(b.messageIndex) ?? []
    list.push(b)
    byMessage.set(b.messageIndex, list)
  }
  return messages.map((message, messageIndex) => {
    const flagged = byMessage.get(messageIndex)
    if (flagged === undefined) return message
    const content = message.content.map((block, blockIndex) => {
      const hit = flagged.find(b => b.blockIndex === blockIndex)
      if (hit === undefined || block.type !== 'text') return block
      const rewritten = redactText(block.text, hit.findings)
      return rewritten === block.text ? block : { ...block, text: rewritten }
    })
    return { ...message, content }
  })
}

/** Audit-safe finding projection: ruleId/type/severity/last4, never the text. */
function summarize(findings: ReadonlyArray<Finding>): Array<{
  ruleId: string
  type: string
  severity: string
  sampleLast4: string
  source?: string
}> {
  return findings.map(f => ({
    ruleId: f.ruleId,
    type: f.type,
    severity: f.severity,
    sampleLast4: f.sampleLast4,
    ...(f.source === undefined ? {} : { source: f.source }),
  }))
}

/** Human-facing ask reason; the approval panel renders it verbatim as its title. */
function summarizeForReason(findings: ReadonlyArray<Finding>): string {
  const parts = findings.slice(0, 4).map(f => `${f.type} …${f.sampleLast4}`)
  const more = findings.length > 4 ? ` 等 ${findings.length} 处` : ''
  return `出口扫描发现 ${findings.length} 处疑似敏感内容（${parts.join('、')}${more}）；放行将原样发送，拒绝将中止本轮`
}

/**
 * Register the pre-step egress gate. The `secscan` settings namespace is
 * installed even in `off` mode so the settings page can switch the policy on
 * later; `source()` always points at the resolved scope (composition entry as
 * the base layer, the user-settings document on top) and is re-read per fire,
 * so mode and ignore-list changes apply without a remount.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const entry: Config = {
    ...config,
    mode: config.mode ?? 'monitor',
    ignoreRuleIds: config.ignoreRuleIds ?? [],
  }
  let source: () => Config = () => entry
  installSettingsSection(ctx, settingsNamespace('secscan'), Config, entry, {
    setSource: (resolved) => { source = resolved },
    onChange: () => {}, // listeners re-read source(); nothing to re-mount
  })

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

  /** Push a JSON-safe summary to connected clients; best-effort, never fatal. */
  const notify = (agentId: string, action: SecscanAction, findings: SecscanFindingSummary[]): void => {
    if (findings.length === 0) return
    try {
      ctx.emit('secscan/findings', {
        sessionId: agentId,
        mode: source().mode ?? 'monitor',
        action,
        findings,
        at: Date.now(),
      } satisfies SecscanFindingsEvent)
    } catch {
      // notification is decoration; a scan decision never depends on it
    }
  }

  // Manual scan surface: the /secrecy-scan command and the secscan_scan tool.
  // Both honor the live ignore list, and neither audits — the audit records
  // egress decisions, and a manual scan sends nothing anywhere.
  const commands = ctx.get('commands')
  const tools = ctx.get('tools')
  if (commands !== undefined || tools !== undefined) {
    const scanTextNow = (text: string): ReturnType<typeof scan> => scan(
      { kind: 'text', content: text },
      {
        known,
        entropy: true,
        ...(source().ignoreRuleIds?.length ? { ignoreRuleIds: source().ignoreRuleIds } : {}),
        ...(source().maxBytes === undefined ? {} : { maxBytes: source().maxBytes }),
      },
    )
    commands?.register({
      name: 'secrecy-scan',
      description: 'Scan text for secrets/credentials before it leaves the machine',
      input: { hint: '<text>' },
      handler: ({ rawInput }: { rawInput: string }): { kind: 'error'; text: string } | { kind: 'success'; text: string } => {
        const text = rawInput.trim()
        if (!text) return { kind: 'error', text: '用法：/secrecy-scan <要检查的文本>' }
        const report = scanTextNow(text)
        if (report.findings.length === 0) return { kind: 'success', text: '未发现疑似敏感内容。' }
        const parts = report.findings.slice(0, 4).map(f => `${f.type} …${f.sampleLast4}`)
        const tail = report.truncated ? '（超长已截断）' : ''
        return { kind: 'success', text: `发现 ${report.findings.length} 处疑似敏感内容：${parts.join('、')}${tail}` }
      },
    })
    tools?.register(defineTool({
      name: 'secscan_scan',
      description: 'Scan a snippet for API keys, tokens and other credentials. Use it to check drafts before sending them anywhere.',
      parameters: {
        text: { type: 'string', required: true, description: 'The text to scan.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            count: { type: 'number', required: true },
            truncated: { type: 'boolean', required: true },
            findings: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  ruleId: { type: 'string', required: true },
                  type: { type: 'string', required: true },
                  severity: { type: 'string', required: true },
                  sampleLast4: { type: 'string', required: true },
                  source: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.findings.length === 0
            ? 'SecScan: no suspected secrets found.'
            : `SecScan: ${value.findings.length} suspected secret(s): ${value.findings.map(f => `${f.type} …${f.sampleLast4}`).join(', ')}`,
        }],
      },
      execute: async (args) => {
        const report = scanTextNow(args.text)
        return { count: report.findings.length, truncated: report.truncated, findings: summarize(report.findings) }
      },
      presentCall: args => ({ card: 'generic', title: 'SecScan 文本扫描', kind: 'other', rawInput: args.text }),
    }))
  }

  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    await knownReady
    const cfg = source()
    const mode = cfg.mode ?? 'monitor'
    if (mode === 'off') return next()
    const ignoreRuleIds = cfg.ignoreRuleIds ?? []
    let batch: ReturnType<typeof scanBatch>
    try {
      batch = config.failScan
        ? (() => {
          throw new Error('injected scan failure')
        })()
        : scanBatch(messages, {
          known,
          entropy: true,
          ...(ignoreRuleIds.length > 0 ? { ignoreRuleIds } : {}),
          ...(cfg.maxBytes === undefined ? {} : { maxBytes: cfg.maxBytes }),
        })
    } catch {
      await audit.record({ egress: 'pre-step', mode, kind: 'scan-error' })
      // monitor/redact fail open: a broken engine must not break the loop.
      // block fails closed: a broken engine must not disable the only gate.
      return mode === 'block' ? { kind: 'reject' } : next()
    }
    if (batch.all.length === 0) return next()
    const actionable = batch.all.some(f => f.severity !== 'info')
    if (mode === 'monitor' || !actionable) {
      const findings = summarize(batch.all)
      await audit.record({
        egress: 'pre-step', mode, action: 'pass',
        findings, truncated: batch.truncated,
      })
      notify(agent.id, 'pass', findings)
      return next() // monitor: observe only; info-only findings never trigger any action
    }
    if (mode === 'redact') {
      const findings = summarize(batch.all)
      await audit.record({
        egress: 'pre-step', mode, action: 'redact',
        findings, truncated: batch.truncated,
      })
      notify(agent.id, 'redact', findings)
      return { kind: 'enter', messages: rewriteBatch(messages, batch.blocks) }
    }
    // block: ask through the approval seam. toolName is a synthetic label (the
    // wire accepts any non-empty string and the UI only displays it); the ask
    // must run inside the open turn this pre-step belongs to. Every
    // non-granting outcome — and any failure to ask at all — fails closed.
    let outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' = 'unavailable'
    try {
      const approval = ctx.get('approval')
      outcome = approval === undefined
        ? 'unavailable'
        : await approval.request({
          agent: agent as Agent,
          toolName: 'secscan',
          reason: summarizeForReason(batch.all),
        })
    } catch {
      outcome = 'unavailable' // outside an open turn, or a failing audit append
    }
    const action: SecscanAction = outcome === 'allowed-once' ? 'allowed' : 'blocked'
    const findings = summarize(batch.all)
    await audit.record({
      egress: 'pre-step', mode, action,
      findings, truncated: batch.truncated,
    })
    notify(agent.id, action, findings)
    return outcome === 'allowed-once' ? next() : { kind: 'reject' }
  })
}
