// @vitest-environment jsdom
/** TokenUsageSection behavior: mode cards, catalog activation, simulation billing, and the CNY bill cards. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { BUILTIN_TOKEN_PLANS } from '../src/billing.ts'
import { TOKEN_USAGE_SETTINGS_NAMESPACE } from '../src/token-usage-settings.ts'
import type { TokenUsageSettings } from '../src/token-usage-settings.ts'
import { TokenUsageController } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import { createTokenUsageStore } from '../src/client/store.ts'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'
import type { TokenUsageSectionProps } from '../src/client/TokenUsageSection.tsx'

afterEach(cleanup)

const t = (key: string): string => zh[key as keyof typeof zh] ?? key

/** One recorded settings write: the field and the value the section submitted. */
interface RecordedWrite {
  field: string
  value: unknown
}

/** Settings-scope stub with an in-memory section and a recorded write queue. */
function stubHost(value: TokenUsageSettings, writable = true) {
  let current: TokenUsageSettings = value
  let revision = 0
  const listeners = new Set<() => void>()
  const host: SettingsScope<TokenUsageSettings> & { writes: RecordedWrite[] } = {
    writes: [],
    getSnapshot: () => ({
      status: 'ready',
      value: current,
      base: undefined,
      user: current,
      revision,
      writable,
      mode: 'host',
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(async (field: string, value: unknown) => {
      host.writes.push({ field, value })
      current = { ...current, [field]: value } as TokenUsageSettings
      revision += 1
      for (const listener of listeners) listener()
    }),
    unset: vi.fn(async () => {}),
  }
  return host
}

function mount(host: ReturnType<typeof stubHost>) {
  const handle = createTokenUsageStore()
  const store = handle.create()
  const controller = new TokenUsageController({ host, store: handle })
  // The apply world binds the rendered actions in the register inject seat.
  controller.bind(store.actions)
  const props: TokenUsageSectionProps & Pick<Required<TokenUsageSectionProps>, 'useStore' | 'actions'> = {
    controller,
    t,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
  }
  render(<TokenUsageSection {...props} />)
  return { store, controller, host }
}

describe('TokenUsageSection', () => {
  it('renders nothing before the shell injects', () => {
    const uninjected = {} as TokenUsageSectionProps
    render(<TokenUsageSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('shows the standard mode selected, the rates, and every catalog plan in CNY', () => {
    mount(stubHost({ mode: 'standard', period: 'off-peak' }))
    expect(screen.getByText('Token 用量与计费')).toBeDefined()
    expect(screen.getByRole('button', { name: /标准计费/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/deepseek-flash：输入 ¥1 \/ 百万/)).toBeDefined()
    for (const plan of BUILTIN_TOKEN_PLANS) {
      expect(screen.getByText(plan.name)).toBeDefined()
      expect(screen.getAllByText(`¥${plan.priceCnyPerMonth.toFixed(2)}`).length).toBeGreaterThan(0)
    }
  })

  it('records a standard-billed call and shows the CNY bill', async () => {
    mount(stubHost({ mode: 'standard', period: 'off-peak' }))
    fireEvent.change(screen.getByTestId('cacheHit'), { target: { value: '1000000' } })
    const calculate = screen.getByRole('button', { name: '计算并记录本次调用' })
    await act(async () => {
      fireEvent.click(calculate)
      await Promise.resolve()
    })
    // 1M cache-hit × ¥0.02 / million = ¥0.02.
    expect(screen.getByText('¥0.02')).toBeDefined()
    expect(screen.getByText('100 万')).toBeDefined()
  })

  it('activates a catalog plan and meters it into the durable mode', () => {
    const host = stubHost({ mode: 'standard', period: 'off-peak' })
    mount(host)
    const lite = BUILTIN_TOKEN_PLANS[0]!
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: '使用此套餐' })[0]!)
    })
    expect(host.writes.at(-1)?.field).toBe('mode')
    expect(host.writes.at(-1)?.value).toEqual({
      planId: 'tokenhub-lite',
      purchasedUnits: lite.allowance,
      usedUnits: 0,
    })
    // The scope echo marks the plan active and renders its allowance meter.
    expect(screen.getByText(/生效套餐/)).toBeDefined()
    expect(screen.getAllByText(/5000 万/).length).toBeGreaterThan(0)
  })

  it('bills an exceeding call against the plan with standard overage', async () => {
    const host = stubHost({
      mode: { planId: 'tokenhub-lite', purchasedUnits: 50_000_000, usedUnits: 49_000_000 },
      period: 'off-peak',
    })
    mount(host)
    fireEvent.change(screen.getByTestId('cacheMiss'), { target: { value: '9000000' } })
    fireEvent.change(screen.getByTestId('output'), { target: { value: '1000000' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '计算并记录本次调用' }))
      await Promise.resolve()
    })
    // In-plan 1M tokens (¥1.92); excess 9M = miss 8.1M (¥8.10) + out 0.9M
    // (¥3.60) at standard flash off-peak rates → ¥11.70; total ¥13.62.
    expect(screen.getByText('¥1.92')).toBeDefined()
    expect(screen.getByText('¥11.70')).toBeDefined()
    expect(screen.getByText('¥13.62')).toBeDefined()
    expect(screen.getByText('900 万')).toBeDefined()
    // The metered mileage moved to the allowance cap in the durable mode.
    expect(host.writes.at(-1)?.value).toEqual({
      planId: 'tokenhub-lite',
      purchasedUnits: 50_000_000,
      usedUnits: 50_000_000,
    })
  })

  it('renews the plan allowance after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const host = stubHost({
      mode: { planId: 'tokenhub-lite', purchasedUnits: 50_000_000, usedUnits: 30_000_000 },
      period: 'off-peak',
    })
    mount(host)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '续费 / 重置额度' }))
      await Promise.resolve()
    })
    expect(confirm).toHaveBeenCalled()
    expect(host.writes.at(-1)?.value).toEqual({
      planId: 'tokenhub-lite',
      purchasedUnits: 50_000_000,
      usedUnits: 0,
    })
    expect(screen.getByText('额度已重置')).toBeDefined()
    confirm.mockRestore()
  })

  it('switches the billing period and re-prices standard calls at peak', async () => {
    const host = stubHost({ mode: 'standard', period: 'off-peak' })
    mount(host)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '高峰时段' }))
      await Promise.resolve()
    })
    expect(host.writes.at(-1)).toEqual({ field: 'period', value: 'peak' })
    fireEvent.change(screen.getByTestId('output'), { target: { value: '1000000' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '计算并记录本次调用' }))
      await Promise.resolve()
    })
    // 1M output × ¥8 / million at peak.
    expect(screen.getByText('¥8.00')).toBeDefined()
  })

  it('disables all writes in read-only scope', () => {
    mount(stubHost({ mode: 'standard', period: 'off-peak' }, false))
    expect(screen.getByText('当前连接为只读模式，计费模式与额度无法修改。')).toBeDefined()
    expect(screen.getByRole('button', { name: /标准计费/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '计算并记录本次调用' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps the namespace constants aligned with the settings scope', () => {
    expect(TOKEN_USAGE_SETTINGS_NAMESPACE).toBe('ui-token-usage')
  })
})
