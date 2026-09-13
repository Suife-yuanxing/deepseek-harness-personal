/**
 * Zero-dependency secret-scanning engine. Pure library: no I/O, no cordis,
 * no dependencies — callers own input acquisition and action on reports.
 * Reports never carry original matched text, only spans and a 4-char tail.
 *
 * @module @deepseek-ai/dsh-secscan
 */
export type { Finding, KnownCredential, ScanInput, ScanOptions, ScanReport, Severity } from './types.js'
