/**
 * Token usage controller: owns the durable settings scope (billing mode,
 * period, and the metered plan mileage) and runs the billing flow for a
 * simulated call. Pure billing math stays in `../billing.ts`; this class only
 * orchestrates scope reads/writes against the engine results.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  consumePlan, standardCostCny, tokenPlanById, totalTokens,
  type ModelId, type PlanConsumption, type TokenBuckets,
} from '../billing.ts'
import { DEFAULT_PERIOD, type TokenUsageMode, type TokenUsageSettings } from '../token-usage-settings.ts'
import type { TokenUsageActions, TokenUsageState } from './store.ts'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** One recorded simulation-call bill, as displayed on the page. */
export type TokenUsageBill =
  | { kind: 'standard'; costCny: number; consumedTokens: number }
  | { kind: 'plan'; planId: string; consumption: PlanConsumption; consumedTokens: number }

/** Dependencies of one Token usage controller. */
export interface TokenUsageControllerDeps {
  /** Durable scope over the `ui-token-usage` namespace. */
  host: SettingsScope<TokenUsageSettings>
  /** Page store the controller mirrors durable state into. */
  store: EngineStoreHandle<TokenUsageState, TokenUsageActions>
}

/**
 * Bill one simulated call under the durable mode and persist any allowance
 * movement.
 */
export class TokenUsageController {
  private readonly host: SettingsScope<TokenUsageSettings>
  private readonly store: EngineStoreHandle<TokenUsageState, TokenUsageActions>
  private bound: BoundActions<typeof this.store> | undefined

  /**
   * @param deps - the durable scope and the page store.
   */
  constructor(deps: TokenUsageControllerDeps) {
    this.host = deps.host
    this.store = deps.store
    // The durable scope notifies on every snapshot replacement; adopting here
    // keeps the mirrored store fresh without subscribing to the store itself
    // (the store handle has no subscribe — instances do, and the controller
    // never needs store-side callbacks).
    deps.host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Bind the renderer actions; the store mirrors durable state from here on. */
  bind(bound: BoundActions<typeof this.store>): void {
    this.bound = bound
    this.adopt()
  }

  /** Mirror the latest durable snapshot into the store. */
  private adopt(): void {
    const snapshot = this.host.getSnapshot()
    this.bound?.syncWritable(snapshot.writable)
    if (snapshot.value === undefined || snapshot.revision === undefined) return
    this.bound?.syncPeriod(snapshot.value.period, snapshot.revision)
    this.bound?.syncMode(snapshot.value.mode, snapshot.revision)
  }

  /** Whether the namespace snapshot is ready and writable. */
  isWritable(): boolean {
    return this.host.getSnapshot().writable
  }

  /**
   * Switch the durable billing mode. Activating a plan purchases the full
   * allowance by default; pass prepared mode objects to restore custom
   * mileage.
   * @param mode - the new durable mode.
   */
  setMode(mode: TokenUsageMode): void {
    if (!this.isWritable()) return
    void this.host.set('mode', mode)
  }

  /**
   * Switch the durable billing period used by standard pricing.
   * @param period - off-peak or peak.
   */
  setPeriod(period: 'off-peak' | 'peak'): void {
    if (!this.isWritable()) return
    void this.host.set('period', period)
  }

  /**
   * Activate one catalog plan with the full allowance purchased.
   * @param planId - a built-in Token Plan id.
   */
  activatePlan(planId: string): void {
    const plan = tokenPlanById(planId)
    if (plan === undefined) return
    this.setMode({ planId, purchasedUnits: plan.allowance, usedUnits: 0 })
  }

  /**
   * Bill one simulated call under the durable mode and persist allowance
   * movement for plan mode. An unknown persisted plan id (stale config)
   * degrades to standard billing instead of failing the call.
   * @param buckets - the call's token consumption.
   * @param model - the model route billed.
   * @returns the bill shown by the page.
   */
  async recordCall(buckets: TokenBuckets, model: ModelId): Promise<TokenUsageBill> {
    const snapshot = this.host.getSnapshot()
    const section = snapshot.value
    const period = section?.period ?? DEFAULT_PERIOD
    const mode: TokenUsageMode = section?.mode ?? 'standard'
    const consumedTokens = totalTokens(buckets)
    if (mode === 'standard') {
      return {
        kind: 'standard',
        costCny: standardCostCny(buckets, model, period),
        consumedTokens,
      }
    }
    const plan = tokenPlanById(mode.planId)
    if (plan === undefined) {
      return {
        kind: 'standard',
        costCny: standardCostCny(buckets, model, period),
        consumedTokens,
      }
    }
    const consumption = consumePlan(buckets, plan, mode.usedUnits, model, period)
    const usedUnits = Math.min(plan.allowance, mode.usedUnits + consumption.consumedUnits)
    if (snapshot.writable) {
      await this.host.set('mode', { planId: plan.id, purchasedUnits: mode.purchasedUnits, usedUnits })
    }
    return { kind: 'plan', planId: plan.id, consumption, consumedTokens }
  }

  /**
   * Reset the active plan's metered mileage to zero (renewal / new cycle).
   * No-op when no plan is active.
   */
  async renewPlan(): Promise<void> {
    const mode = this.host.getSnapshot().value?.mode
    if (typeof mode === 'string' || mode === undefined) return
    if (!this.isWritable()) return
    await this.host.set('mode', { ...mode, usedUnits: 0 })
  }
}
