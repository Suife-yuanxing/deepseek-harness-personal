/**
 * Token usage settings section: the billing-mode selector (standard vs one
 * Token Plan), the built-in plan catalog, the active plan's allowance meter,
 * and a simulation form that bills one call under the active mode and shows
 * its full CNY breakdown. Every money figure renders through
 * {@link formatCny} so the page can never display another currency.
 * Durable state (mode, period, allowance mileage) lives in the settings
 * scope behind the controller; the section mirrors it through the store and
 * writes drafts through the store's declared actions.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BUILTIN_TOKEN_PLANS, formatCny, formatUnits, tokenPlanById, totalTokens,
  type ModelId, type TokenPlan,
} from '../billing.ts'
import type { TokenUsageMode } from '../token-usage-settings.ts'
import { TokenUsageController, type TokenUsageBill } from './controller.ts'
import type { en } from './locales.ts'
import type { createTokenUsageStore, TokenUsageState } from './store.ts'
import styles from './TokenUsageSection.module.css'

/** Injected dependencies of {@link TokenUsageSection} (slot `inject`). */
export interface TokenUsageSectionInjected {
  /** Billing flow and durable-scope writes. */
  controller: TokenUsageController
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Full component props: the inject face spread flat plus the store share
 * (the renderer erases the share boundary at the render call).
 */
export type TokenUsageSectionProps =
  Partial<TokenUsageSectionInjected>
  & PropsStore<ReturnType<typeof createTokenUsageStore>>

/** Model routes selectable in the simulation form. */
const MODEL_CHOICES: readonly ModelId[] = ['deepseek-flash', 'deepseek-v4-pro']

/** Component props after the load guard: controller, copy, and the store share. */
type LoadedProps = Pick<TokenUsageSectionInjected, 'controller' | 't'>
  & PropsStore<ReturnType<typeof createTokenUsageStore>>

/** Whether one durable mode value is an active plan binding. */
function isPlanMode(mode: TokenUsageMode | null): mode is Extract<TokenUsageMode, { planId: string }> {
  return typeof mode === 'object' && mode !== null
}

/**
 * Render the Token usage section content.
 * @param props - slot-delivered injected dependencies and store share.
 * @returns the section, or null while the shell has not injected yet.
 */
export function TokenUsageSection(props: TokenUsageSectionProps): ReactNode {
  const { controller, t, useStore, actions } = props
  if (controller === undefined || t === undefined || useStore === undefined || actions === undefined) {
    return null
  }
  return <Loaded controller={controller} t={t} useStore={useStore} actions={actions} />
}

function Loaded({
  controller, t, useStore, actions,
}: LoadedProps): ReactNode {
  const state = useStore(s => s)
  const planMode = isPlanMode(state.mode) ? state.mode : null
  const activePlan = planMode === null ? undefined : tokenPlanById(planMode.planId)
  // A recorded bill is page-local: it stays until the user records another
  // call, clears the form, or the durable mode leaves it stale (the derived
  // `visibleBill` below drops stale bills instead of clearing on sync).
  const [lastBill, setLastBill] = useState<TokenUsageBill | null>(null)
  const [renewed, setRenewed] = useState(false)

  const consumedDraft = useMemo(() => totalTokens(state.draftBuckets), [state.draftBuckets])

  // The bill shown must match the durable mode it was priced under.
  const visibleBill = lastBill === null || state.mode === null
    ? null
    : lastBill.kind === 'standard' && state.mode === 'standard'
      ? lastBill
      : lastBill.kind === 'plan' && planMode !== null && lastBill.planId === planMode.planId
        ? lastBill
        : null

  const usable = state.mode !== null && state.writable

  const record = (): void => {
    setRenewed(false)
    void controller.recordCall(state.draftBuckets, state.draftModel).then((bill) => { setLastBill(bill) })
  }

  const renew = (): void => {
    if (!window.confirm(t('activePlan.renew.confirm'))) return
    setRenewed(false)
    void controller.renewPlan().then(() => { setRenewed(true) })
  }

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      {!state.writable && state.mode !== null ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      <BillModeCards
        t={t}
        standard={state.mode === 'standard'}
        planActive={planMode !== null}
        disabled={!usable}
        onStandard={() => { setLastBill(null); controller.setMode('standard') }}
        onPlan={() => {
          if (planMode === null) return
          setLastBill(null)
          controller.setMode(planMode)
        }}
      />
      <PeriodRow
        t={t}
        period={state.period}
        disabled={!usable}
        onPeriod={(period) => { controller.setPeriod(period) }}
      />
      <StandardRates t={t} />
      <h3 className={styles['blockTitle']}>{t('planCatalog')}</h3>
      <p className={styles['blockDesc']}>{t('planCatalog.desc')}</p>
      <PlanCatalog
        t={t}
        activePlanId={planMode?.planId}
        disabled={!usable}
        onUse={(plan) => { setLastBill(null); controller.activatePlan(plan.id) }}
      />
      {activePlan !== undefined && planMode !== null
        ? (
          <ActivePlanCard
            t={t}
            plan={activePlan}
            usedUnits={planMode.usedUnits}
            purchasedUnits={planMode.purchasedUnits}
            disabled={!usable}
            renewed={renewed}
            onRenew={renew}
          />
        )
        : null}
      <h3 className={styles['blockTitle']}>{t('simulate.title')}</h3>
      <p className={styles['blockDesc']}>{t('simulate.desc')}</p>
      <div className={styles['card']}>
        <div className={styles['row']}>
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('simulate.model')}</span>
            <select
              className={styles['select']}
              aria-label={t('simulate.model')}
              value={state.draftModel}
              onChange={(event) => {
                const model = event.target.value as ModelId
                if (MODEL_CHOICES.includes(model)) actions.setDraftModel(model)
              }}
            >
              {MODEL_CHOICES.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
          </div>
          <BucketField
            t={t}
            labelKey="simulate.cacheHit"
            testId="cacheHit"
            value={state.draftBuckets.cacheHitInput}
            onChange={(value) => { actions.setDraftBucket('cacheHitInput', value) }}
          />
          <BucketField
            t={t}
            labelKey="simulate.cacheMiss"
            testId="cacheMiss"
            value={state.draftBuckets.cacheMissInput}
            onChange={(value) => { actions.setDraftBucket('cacheMissInput', value) }}
          />
          <BucketField
            t={t}
            labelKey="simulate.output"
            testId="output"
            value={state.draftBuckets.output}
            onChange={(value) => { actions.setDraftBucket('output', value) }}
          />
        </div>
        <div className={styles['row']}>
          <button
            type="button"
            className={styles['primaryButton']}
            disabled={!usable || consumedDraft <= 0}
            onClick={record}
          >
            {t('simulate.calculate')}
          </button>
          <button
            type="button"
            className={styles['secondaryButton']}
            disabled={!usable}
            onClick={() => { setLastBill(null); actions.resetDraft() }}
          >
            {t('simulate.reset')}
          </button>
        </div>
      </div>
      <h3 className={styles['blockTitle']}>{t('bill.title')}</h3>
      <BillCard
        t={t}
        bill={visibleBill}
        activePlan={activePlan}
        period={state.period}
      />
    </div>
  )
}

/** One token-bucket number field of the simulation form. */
function BucketField({
  t, labelKey, testId, value, onChange,
}: {
  t: TokenUsageSectionInjected['t']
  labelKey: keyof typeof en
  testId: string
  value: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <div className={styles['field']}>
      <span className={styles['fieldLabel']}>{t(labelKey)}</span>
      <input
        className={styles['input']}
        type="number"
        min={0}
        inputMode="numeric"
        value={value}
        data-testid={testId}
        onChange={(event) => { onChange(parseNonNegative(event.target.value)) }}
      />
    </div>
  )
}

/** Parse one bucket input: NaN and negatives clamp to zero. */
function parseNonNegative(raw: string): number {
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? 0 : Math.max(0, parsed)
}

/** Mode card pair: standard billing vs Token Plan. */
function BillModeCards({
  t, standard, planActive, disabled, onStandard, onPlan,
}: {
  t: TokenUsageSectionInjected['t']
  standard: boolean
  planActive: boolean
  disabled: boolean
  onStandard: () => void
  onPlan: () => void
}): ReactNode {
  return (
    <>
      <h3 className={styles['blockTitle']}>{t('billingMode')}</h3>
      <div className={styles['modeRow']}>
        <button
          type="button"
          className={`${styles['modeCard']} ${standard ? styles['selected'] : ''}`}
          aria-pressed={standard}
          disabled={disabled}
          onClick={onStandard}
        >
          <span className={styles['modeTitle']}>{t('mode.standard')}</span>
          <span className={styles['modeDesc']}>{t('mode.standard.desc')}</span>
        </button>
        <button
          type="button"
          className={`${styles['modeCard']} ${planActive ? styles['selected'] : ''}`}
          aria-pressed={planActive}
          disabled={disabled}
          onClick={onPlan}
        >
          <span className={styles['modeTitle']}>{t('mode.plan')}</span>
          <span className={styles['modeDesc']}>{t('mode.plan.desc')}</span>
        </button>
      </div>
    </>
  )
}

/** Peak/off-peak period selector. */
function PeriodRow({
  t, period, disabled, onPeriod,
}: {
  t: TokenUsageSectionInjected['t']
  period: TokenUsageState['period']
  disabled: boolean
  onPeriod: (period: TokenUsageState['period']) => void
}): ReactNode {
  return (
    <>
      <h3 className={styles['blockTitle']}>{t('period')}</h3>
      <div className={styles['periodRow']}>
        {(['off-peak', 'peak'] as const).map(value => (
          <button
            key={value}
            type="button"
            className={`${styles['pill']} ${period === value ? styles['pillSelected'] : ''}`}
            aria-pressed={period === value}
            disabled={disabled}
            onClick={() => { onPeriod(value) }}
          >
            {value === 'off-peak' ? t('period.offPeak') : t('period.peak')}
          </button>
        ))}
        <p className={styles['hint']}>{t('period.hint')}</p>
      </div>
    </>
  )
}

/** Standard per-model CNY rate reference (off-peak list prices). */
function StandardRates({ t }: { t: TokenUsageSectionInjected['t'] }): ReactNode {
  return (
    <>
      <h3 className={styles['blockTitle']}>{t('standardRate')}</h3>
      <ul className={styles['rateList']}>
        <li>{t('standardRate.flash')}</li>
        <li>{t('standardRate.pro')}</li>
      </ul>
    </>
  )
}

/** One plan-allowance cell text: tokens vs credits by plan kind. */
function allowanceText(t: TokenUsageSectionInjected['t'], plan: TokenPlan): string {
  return plan.kind === 'token-allowance'
    ? fill(t('plan.tokens'), { units: formatUnits(plan.allowance) })
    : fill(t('plan.credits'), { units: formatUnits(plan.allowance) })
}

/** One plan-overage cell text by overage kind. */
function overageText(t: TokenUsageSectionInjected['t'], plan: TokenPlan): string {
  switch (plan.overage.kind) {
    case 'standard': return t('plan.overage.standard')
    case 'flat': return fill(t('plan.overage.flat'), { cny: formatCny(plan.overage.cnyPerMillionTokens) })
    case 'credit': return fill(t('plan.overage.credit'), { cny: formatCny(plan.overage.cnyPerCredit) })
  }
}

/** Replace `{key}` placeholders in one copy template with the given values. */
function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? '')
}

/** Built-in plan catalog table with per-row activation. */
function PlanCatalog({
  t, activePlanId, disabled, onUse,
}: {
  t: TokenUsageSectionInjected['t']
  activePlanId: string | undefined
  disabled: boolean
  onUse: (plan: TokenPlan) => void
}): ReactNode {
  return (
    <div className={`${styles['card']} ${styles['tableWrap']}`}>
      <table className={styles['table']}>
        <thead>
          <tr>
            <th>{t('plan.name')}</th>
            <th>{t('plan.vendor')}</th>
            <th>{t('plan.price')}</th>
            <th>{t('plan.allowance')}</th>
            <th>{t('plan.period')}</th>
            <th>{t('plan.overage')}</th>
            <th>{t('plan.models')}</th>
            <th>{/* actions header */}</th>
          </tr>
        </thead>
        <tbody>
          {BUILTIN_TOKEN_PLANS.map((plan) => {
            const active = plan.id === activePlanId
            return (
              <tr key={plan.id}>
                <td>
                  {plan.name}
                  {active ? <span className={styles['activeTag']}>{t('plan.active')}</span> : null}
                </td>
                <td>{plan.vendor}</td>
                <td>{formatCny(plan.priceCnyPerMonth)}</td>
                <td>{allowanceText(t, plan)}</td>
                <td>
                  {fill(t('plan.days'), { days: String(plan.periodDays) })}
                  {' / '}
                  {plan.rollover ? t('plan.rollover.yes') : t('plan.rollover.no')}
                </td>
                <td>{overageText(t, plan)}</td>
                <td>{plan.applicableModels.join(', ')}</td>
                <td>
                  {active
                    ? null
                    : (
                      <button
                        type="button"
                        className={styles['useButton']}
                        disabled={disabled}
                        onClick={() => { onUse(plan) }}
                      >
                        {t('plan.use')}
                      </button>
                    )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Active plan allowance meter with renewal. */
function ActivePlanCard({
  t, plan, usedUnits, purchasedUnits, disabled, renewed, onRenew,
}: {
  t: TokenUsageSectionInjected['t']
  plan: TokenPlan
  usedUnits: number
  purchasedUnits: number
  disabled: boolean
  renewed: boolean
  onRenew: () => void
}): ReactNode {
  const ratio = plan.allowance <= 0 ? 0 : Math.min(1, usedUnits / plan.allowance)
  const remaining = Math.max(0, plan.allowance - usedUnits)
  return (
    <div className={styles['card']}>
      <div className={styles['row']}>
        <span className={styles['blockTitle']}>{t('activePlan.title')}：{plan.name}</span>
        <button type="button" className={styles['secondaryButton']} disabled={disabled} onClick={onRenew}>
          {t('activePlan.renew')}
        </button>
      </div>
      <div className={styles['meterRow']}>
        <span className={styles['meterLabel']}>{t('activePlan.consumed')}</span>
        <span className={styles['meterValue']}>
          {formatUnits(usedUnits)} / {formatUnits(purchasedUnits)}
        </span>
      </div>
      <div className={styles['meterBar']}>
        <div
          className={`${styles['meterFill']} ${ratio >= 0.9 ? styles['meterFillWarn'] : ''}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className={styles['meterRow']}>
        <span className={styles['meterLabel']}>{t('activePlan.remaining')}</span>
        <span className={styles['meterValue']}>{formatUnits(remaining)}</span>
      </div>
      {renewed ? <p className={styles['notice']}>{t('activePlan.resetDone')}</p> : null}
    </div>
  )
}

/** Bill breakdown card for the last recorded call. */
function BillCard({
  t, bill, activePlan, period,
}: {
  t: TokenUsageSectionInjected['t']
  bill: TokenUsageBill | null
  activePlan: TokenPlan | undefined
  period: TokenUsageState['period']
}): ReactNode {
  if (bill === null) return <p className={styles['empty']}>{t('bill.empty')}</p>
  if (bill.kind === 'standard') {
    return (
      <div className={styles['card']}>
        <div className={styles['billGrid']}>
          <div className={styles['billCell']}>
            <span className={styles['billLabel']}>{t('bill.mode.standard')}</span>
            <span className={styles['billValue']}>{period === 'peak' ? t('period.peak') : t('period.offPeak')}</span>
          </div>
          <div className={styles['billCell']}>
            <span className={styles['billLabel']}>{t('bill.consumedTokens')}</span>
            <span className={styles['billValue']}>{formatUnits(bill.consumedTokens)}</span>
          </div>
          <div className={styles['billCell']}>
            <span className={styles['billLabel']}>{t('bill.cost')}</span>
            <span className={styles['billValue']}>{formatCny(bill.costCny)}</span>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className={styles['card']}>
      <div className={styles['billGrid']}>
        <div className={styles['billCell']}>
          <span className={styles['billLabel']}>{t('bill.mode.plan')}</span>
          <span className={styles['billValue']}>{activePlan?.name ?? bill.planId}</span>
        </div>
        <div className={styles['billCell']}>
          <span className={styles['billLabel']}>{t('bill.consumedTokens')}</span>
          <span className={styles['billValue']}>{formatUnits(bill.consumedTokens)}</span>
        </div>
        {bill.consumption.exceeded
          ? (
            <div className={styles['billCell']}>
              <span className={styles['billLabel']}>{t('bill.overageTokens')}</span>
              <span className={styles['billValue']}>{formatUnits(bill.consumption.overageTokens)}</span>
            </div>
          )
          : null}
        <div className={styles['billCell']}>
          <span className={styles['billLabel']}>{t('bill.inPlan')}</span>
          <span className={styles['billValue']}>{formatCny(bill.consumption.planCostCny)}</span>
        </div>
        <div className={styles['billCell']}>
          <span className={styles['billLabel']}>{t('bill.overage')}</span>
          <span className={styles['billValue']}>
            {bill.consumption.exceeded
              ? formatCny(bill.consumption.overageCostCny)
              : t('bill.overage.none')}
          </span>
        </div>
        <div className={styles['billCell']}>
          <span className={styles['billLabel']}>{t('bill.cost')}</span>
          <span className={styles['billValue']}>{formatCny(bill.consumption.totalCostCny)}</span>
        </div>
        <div className={styles['billCell']}>
          <span className={styles['billLabel']}>{t('bill.remaining')}</span>
          <span className={styles['billValue']}>{formatUnits(bill.consumption.remainingUnits)}</span>
        </div>
      </div>
    </div>
  )
}
