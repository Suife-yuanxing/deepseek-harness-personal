/** Billing engine behavior: standard CNY rates, plan mileage, overage, and display formatting. */
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_TOKEN_PLANS, consumePlan, formatCny, formatUnits, modelRatesFor, overageCostCny,
  planUnitsFor, standardCostCny, tokenPlanById, totalTokens,
  type TokenBuckets, type TokenPlan,
} from '../src/billing.ts'

const BUCKETS: TokenBuckets = {
  cacheHitInput: 2_000_000,
  cacheMissInput: 4_000_000,
  output: 4_000_000,
}

describe('totalTokens', () => {
  it('sums the three buckets', () => {
    expect(totalTokens(BUCKETS)).toBe(10_000_000)
    expect(totalTokens({ cacheHitInput: 0, cacheMissInput: 0, output: 0 })).toBe(0)
  })
})

describe('modelRatesFor', () => {
  it('returns the off-peak list price triple verbatim', () => {
    expect(modelRatesFor('deepseek-flash', 'off-peak')).toEqual({
      cacheHitInput: 0.02,
      cacheMissInput: 1,
      output: 4,
    })
  })

  it('doubles every rate for the peak period', () => {
    expect(modelRatesFor('deepseek-flash', 'peak')).toEqual({
      cacheHitInput: 0.04,
      cacheMissInput: 2,
      output: 8,
    })
    expect(modelRatesFor('deepseek-v4-pro', 'peak').output).toBe(27)
  })
})

describe('standardCostCny', () => {
  it('prices one request off-peak in CNY', () => {
    // flash: 2M hit × 0.02 + 4M miss × 1 + 4M out × 4 = 0.04 + 4 + 16.
    expect(standardCostCny(BUCKETS, 'deepseek-flash', 'off-peak')).toBeCloseTo(20.04)
  })

  it('prices the same request at double during peak', () => {
    expect(standardCostCny(BUCKETS, 'deepseek-flash', 'peak')).toBeCloseTo(40.08)
  })

  it('prices v4-pro with its own rates', () => {
    // 2M × 0.15 + 4M × 4.5 + 4M × 13.5 = 0.3 + 18 + 54.
    expect(standardCostCny(BUCKETS, 'deepseek-v4-pro', 'off-peak')).toBeCloseTo(72.3)
  })

  it('prices an empty request at zero', () => {
    expect(standardCostCny({ cacheHitInput: 0, cacheMissInput: 0, output: 0 }, 'deepseek-flash', 'off-peak')).toBe(0)
  })
})

describe('planUnitsFor', () => {
  const lite = tokenPlanById('tokenhub-lite')
  const pro = tokenPlanById('tokenhub-pro')

  it('meters raw tokens for token-allowance plans', () => {
    expect(planUnitsFor(BUCKETS, lite!)).toBe(10_000_000)
  })

  it('meters credits through the deduction formula for credit-pool plans', () => {
    // 2M × 20 + 4M × 100 + 4M × 200 = 40M + 400M + 800M, over 1M.
    expect(planUnitsFor(BUCKETS, pro!)).toBeCloseTo(1240)
  })
})

describe('overageCostCny', () => {
  const overageBuckets: TokenBuckets = {
    cacheHitInput: 1_800_000,
    cacheMissInput: 3_600_000,
    output: 3_600_000,
  }
  const standard: TokenPlan = {
    id: 'standard-test',
    name: 'Standard',
    vendor: 'test',
    kind: 'token-allowance',
    priceCnyPerMonth: 100,
    allowance: 10_000_000,
    periodDays: 30,
    rollover: false,
    overage: { kind: 'standard' },
    creditRates: null,
    applicableModels: ['deepseek-flash', 'deepseek-v4-pro'],
  }
  const flat: TokenPlan = {
    id: 'flat-test',
    name: 'Flat',
    vendor: 'test',
    kind: 'token-allowance',
    priceCnyPerMonth: 100,
    allowance: 10_000_000,
    periodDays: 30,
    rollover: false,
    overage: { kind: 'flat', cnyPerMillionTokens: 2 },
    creditRates: null,
    applicableModels: ['deepseek-flash', 'deepseek-v4-pro'],
  }
  const credit: TokenPlan = {
    id: 'credit-test',
    name: 'Credit',
    vendor: 'test',
    kind: 'credit-pool',
    priceCnyPerMonth: 100,
    allowance: 50_000,
    periodDays: 30,
    rollover: false,
    overage: { kind: 'credit', cnyPerCredit: 0.01 },
    creditRates: { cacheHitInput: 20, cacheMissInput: 100, output: 200 },
    applicableModels: ['deepseek-flash', 'deepseek-v4-pro'],
  }

  it('bills an excess slice at the standard per-model rates', () => {
    // 1.8M hit × 0.02 + 1.8M miss × 1 + 3.6M out × 4 = 0.036 + 3.6 + 14.4.
    expect(overageCostCny(overageBuckets, standard, 'deepseek-flash', 'off-peak')).toBeCloseTo(18.036)
  })

  it('doubles the standard bill in the peak period', () => {
    expect(overageCostCny(overageBuckets, standard, 'deepseek-flash', 'peak')).toBeCloseTo(36.072)
  })

  it('bills a flat rate per million excess tokens', () => {
    // 9M excess tokens × 2 CNY per million.
    expect(overageCostCny(overageBuckets, flat, 'deepseek-flash', 'off-peak')).toBeCloseTo(18)
    expect(
      overageCostCny(
        overageBuckets,
        { ...flat, overage: { kind: 'flat', cnyPerMillionTokens: 3 } },
        'deepseek-flash',
        'off-peak',
      ),
    ).toBeCloseTo(27)
  })

  it('bills credits at the per-credit price', () => {
    // 1.8M × 20 + 3.6M × 100 + 3.6M × 200 = 36M + 360M + 720M → 1116 credits.
    expect(overageCostCny(overageBuckets, credit, 'deepseek-flash', 'off-peak')).toBeCloseTo(11.16)
  })
})

describe('consumePlan', () => {
  const lite = tokenPlanById('tokenhub-lite')!

  it('consumes inside the remaining allowance without overage', () => {
    const bill = consumePlan(BUCKETS, lite, 10_000_000, 'deepseek-flash', 'off-peak')
    expect(bill.consumedUnits).toBe(10_000_000)
    expect(bill.remainingUnits).toBe(30_000_000)
    expect(bill.exceeded).toBe(false)
    expect(bill.overageTokens).toBe(0)
    expect(bill.overageCostCny).toBe(0)
    // 96 CNY / 50M × 10M.
    expect(bill.planCostCny).toBeCloseTo(19.2)
    expect(bill.totalCostCny).toBeCloseTo(19.2)
  })

  it('lands exactly on zero remaining without flagging overage', () => {
    const bill = consumePlan(BUCKETS, lite, 40_000_000, 'deepseek-flash', 'off-peak')
    expect(bill.consumedUnits).toBe(10_000_000)
    expect(bill.remainingUnits).toBe(0)
    expect(bill.exceeded).toBe(false)
  })

  it('bills the excess slice at the standard rates once the allowance runs out', () => {
    const bill = consumePlan(BUCKETS, lite, 49_000_000, 'deepseek-flash', 'off-peak')
    expect(bill.consumedUnits).toBe(1_000_000)
    expect(bill.remainingUnits).toBe(0)
    expect(bill.exceeded).toBe(true)
    // Excess buckets: hit 1.8M, miss 3.6M, out 3.6M (90% of the call):
    // 1.8M×0.02 + 3.6M×1 + 3.6M×4.
    expect(bill.overageTokens).toBeCloseTo(9_000_000)
    expect(bill.overageCostCny).toBeCloseTo(18.036)
    expect(bill.planCostCny).toBeCloseTo(1.92)
    expect(bill.totalCostCny).toBeCloseTo(19.956)
  })

  it('bills the whole call as excess when nothing remains', () => {
    const bill = consumePlan(BUCKETS, lite, 50_000_000, 'deepseek-flash', 'off-peak')
    expect(bill.consumedUnits).toBe(0)
    expect(bill.remainingUnits).toBe(0)
    expect(bill.exceeded).toBe(true)
    expect(bill.overageTokens).toBe(10_000_000)
    expect(bill.overageCostCny).toBeCloseTo(20.04)
    expect(bill.planCostCny).toBe(0)
    expect(bill.totalCostCny).toBeCloseTo(20.04)
  })

  it('bills a flat excess rate for flat-overage plans', () => {
    const flat: TokenPlan = { ...lite, overage: { kind: 'flat', cnyPerMillionTokens: 3 } }
    const bill = consumePlan(BUCKETS, flat, 49_000_000, 'deepseek-flash', 'off-peak')
    expect(bill.overageCostCny).toBeCloseTo(27)
    expect(bill.totalCostCny).toBeCloseTo(28.92)
  })

  it('meters and overages in credits for credit-pool plans', () => {
    const pro = tokenPlanById('tokenhub-pro')!
    const bill = consumePlan(BUCKETS, pro, 49_000, 'deepseek-flash', 'off-peak')
    // The call meters 1240 credits; 1000 fit in the remaining allowance.
    expect(bill.consumedUnits).toBeCloseTo(1000)
    expect(bill.remainingUnits).toBe(0)
    expect(bill.exceeded).toBe(true)
    expect(bill.overageCostCny).toBeCloseTo(240 * 0.0099)
    expect(bill.planCostCny).toBeCloseTo(493 / 50_000 * 1000)
  })

  it('clamps an over-metered used count to the allowance', () => {
    const bill = consumePlan(BUCKETS, lite, 60_000_000, 'deepseek-flash', 'off-peak')
    expect(bill.remainingUnits).toBe(0)
    expect(bill.exceeded).toBe(true)
  })
})

describe('catalog', () => {
  it('looks built-in plans up by id', () => {
    expect(tokenPlanById('tokenhub-lite')?.name).toBe('Token Plan 轻享套餐')
    expect(tokenPlanById('tokenhub-pro')?.kind).toBe('credit-pool')
    expect(tokenPlanById('deepseek-monthly')).toBeDefined()
  })

  it('returns undefined for unknown ids', () => {
    expect(tokenPlanById('nope')).toBeUndefined()
  })

  it('keeps the catalog frozen so entries cannot drift at runtime', () => {
    expect(Object.isFrozen(BUILTIN_TOKEN_PLANS)).toBe(true)
  })
})

describe('formatCny', () => {
  it('formats two decimals with the CNY sign', () => {
    expect(formatCny(19.2)).toBe('¥19.20')
    expect(formatCny(0)).toBe('¥0.00')
    expect(formatCny(0.023)).toBe('¥0.02')
  })
})

describe('formatUnits', () => {
  it('formats plain integers bare', () => {
    expect(formatUnits(1234)).toBe('1234')
    expect(formatUnits(0)).toBe('0')
  })

  it('uses 万 above ten thousand and 亿 above one hundred million', () => {
    expect(formatUnits(50_000_000)).toBe('5000 万')
    expect(formatUnits(10_000)).toBe('1 万')
    expect(formatUnits(120_000_000)).toBe('1.2 亿')
  })

  it('keeps fractional units readable', () => {
    expect(formatUnits(66.6667)).toBe('66.67')
  })
})
