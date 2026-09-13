import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AuditRecord {
  [key: string]: unknown
}

export interface Audit {
  record(rec: AuditRecord): Promise<void>
}

const TRIM_HEADROOM = 200

/**
 * Local-only JSONL audit at `<dsh home>/secscan/audit.jsonl`. Records carry
 * summarized findings (ruleId/type/severity/last4) and never original secret
 * text. One append per record; past `max` lines plus headroom the file is
 * trimmed to the newest `max` records via a temp-file rename. Every failure
 * is contained: auditing is best-effort and must never break a scan decision.
 */
export function createAudit(options: { file: string; max?: number }): Audit {
  const max = options.max ?? 1000
  return {
    async record(rec: AuditRecord): Promise<void> {
      try {
        const dir = dirname(options.file)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        appendFileSync(options.file, `${JSON.stringify({ at: Date.now(), ...rec })}\n`, 'utf8')
        const lines = readFileSync(options.file, 'utf8').split('\n').filter(l => l.length > 0)
        if (lines.length > max + TRIM_HEADROOM) {
          const tmp = `${options.file}.tmp`
          writeFileSync(tmp, `${lines.slice(lines.length - max).join('\n')}\n`, 'utf8')
          renameSync(tmp, options.file)
        }
      } catch {
        // Audit is best-effort by design; scanning decisions never depend on it.
      }
    },
  }
}
