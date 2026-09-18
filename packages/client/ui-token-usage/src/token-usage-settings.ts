/**
 * Durable Token usage section shared by the Host schema and the browser
 * scope: the active billing mode (standard vs one Token Plan with its
 * metered mileage) and the billing period the standard mode prices with.
 */

import z from '@deepseek-ai/schemastery'
import type { BillPeriod } from './billing.ts'

/** Settings namespace owned by the token-usage plugin. */
export const TOKEN_USAGE_SETTINGS_NAMESPACE = 'ui-token-usage'

/** Billing periods accepted at the registry and settings boundaries. */
export const BILL_PERIODS = ['off-peak', 'peak'] as const

/**
 * Durable billing mode: `standard` for per-token standard rates, or one
 * active Token Plan with the allowance units already metered this cycle.
 */
export type TokenUsageMode =
  | 'standard'
  | { planId: string; purchasedUnits: number; usedUnits: number }

/** Durable Token usage section value. */
export interface TokenUsageSettings {
  /** Active billing mode. */
  mode: TokenUsageMode
  /** Billing period used by standard-mode pricing. */
  period: BillPeriod
}

/** Default billing period when the user-settings document has no override. */
export const DEFAULT_PERIOD: BillPeriod = 'off-peak'

/** Durable Token usage schema; also the wire envelope the browser scope validates against. */
export const TokenUsageSettingsSchema: z<TokenUsageSettings> = z.object({
  mode: z.union([
    z.const('standard'),
    z.object({
      planId: z.string(),
      purchasedUnits: z.number().min(0),
      usedUnits: z.number().min(0),
    }),
  ]).default('standard'),
  period: z.union([...BILL_PERIODS]).default(DEFAULT_PERIOD),
})
