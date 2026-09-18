/**
 * Token usage page store: mirrors the durable billing mode/period snapshots
 * (written only by the apply-world controller) and carries the page-local
 * simulation draft. The bill of a recorded call is component-local state;
 * billing math stays in the pure engine and the controller.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { BillPeriod, ModelId, TokenBuckets } from '../billing.ts'
import type { TokenUsageMode } from '../token-usage-settings.ts'

/** Token usage page state. */
export interface TokenUsageState {
  /** Durable billing mode; null until the first settings snapshot lands. */
  mode: TokenUsageMode | null
  /** Durable billing period. */
  period: BillPeriod
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Model selected in the simulation form. */
  draftModel: ModelId
  /** Token buckets entered in the simulation form. */
  draftBuckets: TokenBuckets
  /** Settings revision the mode was synced from; -1 before the first snapshot. */
  revision: number
  /** Settings revision the period was synced from; -1 before the first snapshot. */
  periodRevision: number
}

/** Declared action shape giving the exported factory a stable return type. */
export type TokenUsageActions = {
  syncMode: (draft: TokenUsageState, mode: TokenUsageMode, revision: number) => void
  syncPeriod: (draft: TokenUsageState, period: BillPeriod, revision: number) => void
  syncWritable: (draft: TokenUsageState, writable: boolean) => void
  setDraftModel: (draft: TokenUsageState, model: ModelId) => void
  setDraftBucket: (
    draft: TokenUsageState,
    field: 'cacheHitInput' | 'cacheMissInput' | 'output',
    value: number,
  ) => void
  resetDraft: (draft: TokenUsageState) => void
}

/** Initial bucket values of a fresh simulation form. */
export const EMPTY_BUCKETS: TokenBuckets = Object.freeze({
  cacheHitInput: 0,
  cacheMissInput: 0,
  output: 0,
})

/**
 * Declares the Token usage page state and write surface.
 * @returns the store handle.
 */
export function createTokenUsageStore(): EngineStoreHandle<TokenUsageState, TokenUsageActions> {
  return defineStore({
    init: (): TokenUsageState => ({
      mode: null,
      period: 'off-peak',
      writable: true,
      draftModel: 'deepseek-flash',
      draftBuckets: { ...EMPTY_BUCKETS },
      revision: -1,
      periodRevision: -1,
    }),
    actions: {
      syncMode: (d, mode: TokenUsageMode, revision: number) => {
        if (revision <= d.revision) return
        d.mode = mode
        d.revision = revision
      },
      syncPeriod: (d, period: BillPeriod, revision: number) => {
        if (revision <= d.periodRevision) return
        d.period = period
        d.periodRevision = revision
      },
      syncWritable: (d, writable: boolean) => {
        d.writable = writable
      },
      setDraftModel: (d, model: ModelId) => {
        d.draftModel = model
      },
      setDraftBucket: (d, field, value: number) => {
        d.draftBuckets = { ...d.draftBuckets, [field]: clampNonNegative(value) }
      },
      resetDraft: (d) => {
        d.draftBuckets = { ...EMPTY_BUCKETS }
      },
    },
  })
}

/** Coerce one bucket input to a non-negative integer token count. */
function clampNonNegative(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.max(0, Math.floor(value))
}
