/**
 * Token billing engine: standard per-million-token CNY rates and the built-in
 * Token Plan catalog, plus the pure functions that turn one request's token
 * buckets into a bill under either billing mode. All money amounts are CNY;
 * the engine never formats or converts to another currency.
 */

/**
 * One request's token consumption, split into the pricing buckets reported by
 * LLM providers (cache-hit input, cache-miss input, output).
 */
export interface TokenBuckets {
  /** Input tokens served from the prompt cache. */
  cacheHitInput: number
  /** Input tokens not served from the prompt cache. */
  cacheMissInput: number
  /** Generated output tokens. */
  output: number
}

/** Sum one request's buckets into its total token count. */
export function totalTokens(buckets: TokenBuckets): number {
  return buckets.cacheHitInput + buckets.cacheMissInput + buckets.output
}

/** Per-million-token CNY price triple for one model route. */
export interface ModelRates {
  /** CNY per million cache-hit input tokens. */
  cacheHitInput: number
  /** CNY per million cache-miss input tokens. */
  cacheMissInput: number
  /** CNY per million output tokens. */
  output: number
}

/** Model routes the billing engine prices natively. */
export type ModelId = 'deepseek-flash' | 'deepseek-v4-pro'

/**
 * DeepSeek official off-peak list prices in CNY per million tokens
 * (api-docs.deepseek.com/quick_start/pricing, 2026-09). Peak prices are
 * exactly double the off-peak values; see {@link modelRatesFor}.
 */
export const STANDARD_MODEL_RATES: Readonly<Record<ModelId, ModelRates>> = Object.freeze({
  'deepseek-flash': Object.freeze({
    cacheHitInput: 0.02,
    cacheMissInput: 1,
    output: 4,
  }),
  'deepseek-v4-pro': Object.freeze({
    cacheHitInput: 0.15,
    cacheMissInput: 4.5,
    output: 13.5,
  }),
})

/** Billing period; peak doubles the off-peak price. */
export type BillPeriod = 'off-peak' | 'peak'

/**
 * Resolve one model route's rates for the active billing period.
 * @param model - the model route.
 * @param period - off-peak (list price) or peak (double).
 * @returns the per-million-token CNY price triple.
 */
export function modelRatesFor(model: ModelId, period: BillPeriod): ModelRates {
  const base = STANDARD_MODEL_RATES[model]
  if (period === 'off-peak') return base
  return {
    cacheHitInput: base.cacheHitInput * 2,
    cacheMissInput: base.cacheMissInput * 2,
    output: base.output * 2,
  }
}

/**
 * Standard billing cost of one request in CNY.
 * @param buckets - the token buckets consumed.
 * @param model - the model route billed.
 * @param period - the billing period.
 * @returns the CNY amount (fractional, formatted at display time).
 */
export function standardCostCny(buckets: TokenBuckets, model: ModelId, period: BillPeriod): number {
  const rates = modelRatesFor(model, period)
  return (
    buckets.cacheHitInput * rates.cacheHitInput
    + buckets.cacheMissInput * rates.cacheMissInput
    + buckets.output * rates.output
  ) / 1_000_000
}

/** How a Token Plan meters its allowance: raw tokens or credit points. */
export type TokenPlanKind = 'token-allowance' | 'credit-pool'

/** Excess-billing rule of one Token Plan, in CNY. */
export type TokenPlanOverage =
  /** Beyond the allowance, fall back to the standard per-model CNY rates. */
  | { kind: 'standard' }
  /** Token-allowance plan: flat CNY per million excess tokens. */
  | { kind: 'flat'; cnyPerMillionTokens: number }
  /** Credit-pool plan: flat CNY per excess credit. */
  | { kind: 'credit'; cnyPerCredit: number }

/** One prepaid monthly Token Plan in the built-in catalog. */
export interface TokenPlan {
  /** Stable plan id referenced by the durable billing mode. */
  id: string
  /** Display name of the plan. */
  name: string
  /** Vendor operating the plan. */
  vendor: string
  /** Metering kind: raw tokens or credit points. */
  kind: TokenPlanKind
  /** Monthly price in CNY. */
  priceCnyPerMonth: number
  /**
   * Monthly allowance: tokens for `token-allowance`, credits for
   * `credit-pool`. Mileage is metered against this unit.
   */
  allowance: number
  /** Validity period in days (the monthly cycle). */
  periodDays: number
  /** Whether unused allowance rolls over into the next cycle. */
  rollover: boolean
  /** CNY rule applied to consumption beyond the allowance. */
  overage: TokenPlanOverage
  /**
   * Credit-pool deduction rates (credits per million tokens, one per pricing
   * bucket); null for token-allowance plans, which meter raw tokens.
   */
  creditRates: ModelRates | null
  /** Model routes the plan covers. */
  applicableModels: readonly ModelId[]
}

/**
 * Built-in Token Plan catalog. Prices follow the products' published list
 * prices (2026-09), with USD list prices converted at 7.05 CNY/USD:
 * - tokenhub-lite / tokenhub-pro: Tencent Cloud TokenHub Token Plan
 *   enterprise plans (intl.cloud.tencent.com/document/product/1300/81489,
 *   81490); unused allowance expires at the monthly cycle end.
 * - deepseek-monthly: a common flat monthly-allowance product shape
 *   (e.g. 50 CNY for a prepaid token pool) kept as a maintenance reference;
 *   its overage rule falls back to the standard rates.
 * Add or replace entries here to extend the catalog; the settings page
 * displays the catalog as-is.
 */
export const BUILTIN_TOKEN_PLANS: readonly TokenPlan[] = Object.freeze([
  Object.freeze<TokenPlan>({
    id: 'tokenhub-lite',
    name: 'Token Plan 轻享套餐',
    vendor: '腾讯云 TokenHub',
    kind: 'token-allowance',
    priceCnyPerMonth: 96,
    allowance: 50_000_000,
    periodDays: 30,
    rollover: false,
    overage: { kind: 'standard' },
    creditRates: null,
    applicableModels: Object.freeze(['deepseek-flash', 'deepseek-v4-pro']),
  }),
  Object.freeze<TokenPlan>({
    id: 'tokenhub-pro',
    name: 'Token Plan 专业套餐',
    vendor: '腾讯云 TokenHub',
    kind: 'credit-pool',
    priceCnyPerMonth: 493,
    allowance: 50_000,
    periodDays: 30,
    rollover: false,
    overage: { kind: 'credit', cnyPerCredit: 0.0099 },
    creditRates: Object.freeze({
      cacheHitInput: 20,
      cacheMissInput: 100,
      output: 200,
    }),
    applicableModels: Object.freeze(['deepseek-flash', 'deepseek-v4-pro']),
  }),
  Object.freeze<TokenPlan>({
    id: 'deepseek-monthly',
    name: '月度 Token 补充包',
    vendor: 'DeepSeek 官方形态',
    kind: 'token-allowance',
    priceCnyPerMonth: 50,
    allowance: 12_000_000,
    periodDays: 30,
    rollover: false,
    overage: { kind: 'standard' },
    creditRates: null,
    applicableModels: Object.freeze(['deepseek-flash', 'deepseek-v4-pro']),
  }),
])

/** Look one catalog plan up by id; undefined for unknown ids. */
export function tokenPlanById(id: string): TokenPlan | undefined {
  return BUILTIN_TOKEN_PLANS.find(plan => plan.id === id)
}

/**
 * Mileage one request consumes from a plan's allowance: raw tokens for
 * token-allowance plans; for credit-pool plans the official deduction
 * formula (hit*rateH + miss*rateM + out*rateO) / 1,000,000 credits.
 * @param buckets - the token buckets consumed.
 * @param plan - the plan metering the request.
 * @returns the consumed allowance units (tokens or credits).
 */
export function planUnitsFor(buckets: TokenBuckets, plan: TokenPlan): number {
  if (plan.kind === 'token-allowance') return totalTokens(buckets)
  const rates = plan.creditRates
  if (rates === null) return totalTokens(buckets)
  return (
    buckets.cacheHitInput * rates.cacheHitInput
    + buckets.cacheMissInput * rates.cacheMissInput
    + buckets.output * rates.output
  ) / 1_000_000
}

/** Result of billing one request against a plan's remaining allowance. */
export interface PlanConsumption {
  /** Allowance units consumed inside the plan (capped at the remaining allowance). */
  consumedUnits: number
  /** Allowance units remaining after this request. */
  remainingUnits: number
  /** Whether the request exceeded the remaining allowance. */
  exceeded: boolean
  /** Excess tokens billed at the overage rule (0 when not exceeded). */
  overageTokens: number
  /** Excess cost in CNY (0 when not exceeded). */
  overageCostCny: number
  /** In-plan cost in CNY, proportional to the plan's unit value. */
  planCostCny: number
  /** Total CNY cost of the request (in-plan + overage). */
  totalCostCny: number
}

/**
 * Scale every bucket by one ratio, splitting a request into the in-plan and
 * excess slices proportionally when the allowance cuts through it.
 */
function scaleBuckets(buckets: TokenBuckets, ratio: number): TokenBuckets {
  return {
    cacheHitInput: buckets.cacheHitInput * ratio,
    cacheMissInput: buckets.cacheMissInput * ratio,
    output: buckets.output * ratio,
  }
}

/**
 * CNY cost of one fully-excess bucket slice under a plan's overage rule.
 * @param buckets - the excess slice (already proportional to the excess units).
 * @param plan - the plan whose overage rule applies.
 * @param model - model route for `standard` overage billing.
 * @param period - billing period for `standard` overage billing.
 * @returns the CNY amount.
 */
export function overageCostCny(
  buckets: TokenBuckets,
  plan: TokenPlan,
  model: ModelId,
  period: BillPeriod,
): number {
  switch (plan.overage.kind) {
    case 'standard': {
      return standardCostCny(buckets, model, period)
    }
    case 'flat': {
      return totalTokens(buckets) * plan.overage.cnyPerMillionTokens / 1_000_000
    }
    case 'credit': {
      return planUnitsFor(buckets, plan) * plan.overage.cnyPerCredit
    }
  }
}

/**
 * Bill one request against a plan: consume allowance units up to the
 * remaining allowance, then price any excess slice at the plan's overage
 * rule. The in-plan slice is priced at the plan's unit value (monthly price
 * divided by the allowance), so the displayed CNY always matches the plan.
 * @param buckets - the token buckets consumed.
 * @param plan - the active plan.
 * @param usedUnits - allowance units already consumed this cycle.
 * @param model - model route for `standard` overage billing.
 * @param period - billing period for `standard` overage billing.
 * @returns the full consumption bill.
 */
export function consumePlan(
  buckets: TokenBuckets,
  plan: TokenPlan,
  usedUnits: number,
  model: ModelId,
  period: BillPeriod,
): PlanConsumption {
  const units = planUnitsFor(buckets, plan)
  const remaining = Math.max(0, plan.allowance - usedUnits)
  const inPlan = Math.min(units, remaining)
  const excess = units - inPlan
  const planCostCny = plan.priceCnyPerMonth / plan.allowance * inPlan
  if (excess <= 0) {
    return {
      consumedUnits: inPlan,
      remainingUnits: plan.allowance - usedUnits - inPlan,
      exceeded: false,
      overageTokens: 0,
      overageCostCny: 0,
      planCostCny,
      totalCostCny: planCostCny,
    }
  }
  const excessBuckets = scaleBuckets(buckets, excess / units)
  const excessCost = overageCostCny(excessBuckets, plan, model, period)
  return {
    consumedUnits: inPlan,
    remainingUnits: 0,
    exceeded: true,
    overageTokens: totalTokens(excessBuckets),
    overageCostCny: excessCost,
    planCostCny,
    totalCostCny: planCostCny + excessCost,
  }
}

/**
 * Format one CNY amount for display; every money figure on the Token usage
 * page goes through this formatter so no other currency can leak in.
 * @param amountCny - the CNY amount.
 * @returns a CNY string like `¥1.23` (never a negative sign for zero).
 */
export function formatCny(amountCny: number): string {
  return `¥${amountCny.toFixed(2)}`
}

/** Format one token/unit count compactly (亿/万 units for large numbers). */
export function formatUnits(units: number): string {
  if (units >= 100_000_000) return `${trimZero(units / 100_000_000)} 亿`
  if (units >= 10_000) return `${trimZero(units / 10_000)} 万`
  return trimZero(units)
}

/** Trim trailing fractional zeros from a rounded decimal string. */
function trimZero(value: number): string {
  const fixed = value.toFixed(value % 1 === 0 ? 0 : 2)
  return fixed
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}
