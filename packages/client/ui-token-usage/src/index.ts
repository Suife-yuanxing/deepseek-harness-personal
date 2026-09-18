/**
 * Host registration for the durable Token usage section: registers the
 * `ui-token-usage` settings namespace so the browser scope can persist the
 * active billing mode and period. The namespace is registered through the
 * cross-generation bridge (dsh-settings ≥0.1.5 removed `settingsNamespace()`
 * and registers the raw string; pre-split Hosts need the brand).
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  TOKEN_USAGE_SETTINGS_NAMESPACE, TokenUsageSettingsSchema,
} from './token-usage-settings.ts'
import { resolveSettingsNamespace } from './settings-register.ts'

export {
  BILL_PERIODS, DEFAULT_PERIOD, TOKEN_USAGE_SETTINGS_NAMESPACE,
  type TokenUsageMode, type TokenUsageSettings,
} from './token-usage-settings.ts'
export {
  BUILTIN_TOKEN_PLANS, STANDARD_MODEL_RATES, consumePlan, formatCny, formatUnits,
  modelRatesFor, overageCostCny, planUnitsFor, standardCostCny, tokenPlanById, totalTokens,
  type BillPeriod, type ModelId, type ModelRates, type PlanConsumption,
  type TokenBuckets, type TokenPlan, type TokenPlanKind, type TokenPlanOverage,
} from './billing.ts'
export { resolveSettingsNamespace } from './settings-register.ts'

/**
 * Register the durable Token usage section when the optional Host settings
 * service is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      resolveSettingsNamespace(TOKEN_USAGE_SETTINGS_NAMESPACE),
      TokenUsageSettingsSchema,
    )
  })
}
