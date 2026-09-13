import type { Finding, Severity } from './types.js'

export interface Rule {
  id: string
  type: string
  severity: Severity
  pattern: RegExp
}

/**
 * Curated high-confidence rules, self-authored (informed by public knowledge
 * of token shapes; no third-party rule file is embedded). Regexes are used
 * via `matchAll` with fresh iteration, so their `g` flag is never stateful.
 */
export const RULES: Rule[] = [
  { id: 'generic-sk-token', type: 'sk-token', severity: 'high', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'anthropic-key', type: 'api-key', severity: 'high', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'aws-access-key-id', type: 'cloud-credential', severity: 'critical', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-pat', type: 'api-token', severity: 'high', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { id: 'github-classic-token', type: 'api-token', severity: 'high', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'google-api-key', type: 'api-key', severity: 'high', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'slack-token', type: 'api-token', severity: 'high', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'private-key-block', type: 'private-key', severity: 'critical', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'jwt', type: 'jwt', severity: 'high', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g },
  { id: 'db-conn-cred', type: 'connection-string', severity: 'high', pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/g },
  { id: 'env-secret-assign', type: 'secret-assignment', severity: 'medium', pattern: /(?:^|\n)\s*[a-z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|ACCESS_?KEY)[a-z0-9_]*\s*[:=]\s*["']?[^\s"']{8,}/gi },
  { id: 'json-secret-field', type: 'secret-field', severity: 'medium', pattern: /["'](?:api[_-]?key|secret|token|password|access[_-]?token)["']\s*:\s*["'][^"']{8,}["']/gi },
  { id: 'yaml-secret-field', type: 'secret-field', severity: 'medium', pattern: /(?:^|\n)\s*(?:api[_-]?key|secret|token|password|access[_-]?token)\s*:\s*["']?[^\s"']{8,}/gi },
  { id: 'bearer-token', type: 'bearer-token', severity: 'medium', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  { id: 'npm-token', type: 'api-token', severity: 'high', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'openai-project-key', type: 'api-key', severity: 'high', pattern: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'stripe-key', type: 'api-key', severity: 'high', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: 'sendgrid-key', type: 'api-key', severity: 'high', pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  { id: 'twilio-key', type: 'api-key', severity: 'high', pattern: /\bSK[0-9a-fA-F]{32}\b/g },
  { id: 'gcp-service-account', type: 'private-key', severity: 'high', pattern: /"type"\s*:\s*"service_account"/g },
  { id: 'heroku-key', type: 'api-key', severity: 'high', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g },
  { id: 'url-cred-param', type: 'credential-param', severity: 'medium', pattern: /[?&](?:api[_-]?key|token|password|access[_-]?token)=[a-z0-9._-]{8,}/gi },
]

const last4 = (s: string): string => s.slice(-4)

/** Run every rule over `text`; one finding per match. */
export function scanRules(text: string): Finding[] {
  const findings: Finding[] = []
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      const start = m.index
      const end = start + m[0].length
      findings.push({ ruleId: rule.id, type: rule.type, severity: rule.severity, start, end, sampleLast4: last4(m[0]) })
    }
  }
  return findings
}
