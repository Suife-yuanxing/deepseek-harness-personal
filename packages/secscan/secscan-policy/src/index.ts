/**
 * Egress secret-scan policy. The pre-step gate lands with the plugin body;
 * the audit store is already usable standalone.
 * @module @deepseek-ai/dsh-secscan-policy
 */
export { createAudit } from './audit.js'
export type { Audit, AuditRecord } from './audit.js'
