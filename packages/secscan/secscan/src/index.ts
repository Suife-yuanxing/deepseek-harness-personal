/** @module @deepseek-ai/dsh-secscan */
export type { Finding, KnownCredential, ScanInput, ScanOptions, ScanReport, Severity } from './types.js'
export { scan } from './scan.js'
export { redactText } from './redact.js'
export { scanRules, RULES } from './rules.js'
export { scanEntropy, shannonEntropy } from './entropy.js'
export { buildKnownCredentials, scanKnownCredentials } from './fingerprint.js'
