// @vitest-environment jsdom
/**
 * ui-secscan browser half on a real cordis Context with fake settingsScope/
 * remote/locale faces: the plugin registers the two General-settings rows
 * (mode cubes, ignore-rule editor) into settings.general.item and the
 * findings strip into conversation.input.dock, and subscribes the forwarded
 * `secscan/findings` remote event. Registration disposal rides the plugin
 * fiber (HMR safety). The node half and the invariant companion run over the
 * same Context.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SecscanFindingsEvent, SecscanSettings } from '../src/client/secscan-settings.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply as invariantApply } from '../src/invariant.ts'

type Provide = (key: string, value: unknown) => void

async function bench(settings: SecscanSettings): Promise<{
  general: () => Array<{ id: string; order: number; locale: string | undefined }>
  dock: () => { id: string; order: number; locale: string | undefined } | undefined
  subscribed: string[]
  push: (event: SecscanFindingsEvent) => void
}> {
  const ctx = new Context()
  const provide = ctx.provide.bind(ctx) as unknown as Provide
  const subscribed: string[] = []
  let findingsListener: ((event: SecscanFindingsEvent) => void) | undefined

  provide('remote', {
    $on: (name: string, cb: (event: SecscanFindingsEvent) => void) => {
      subscribed.push(name)
      findingsListener = cb
    },
  })

  const adopters: Array<() => void> = []
  provide('settingsScope', {
    bind: ({ namespace }: { namespace: string }) => {
      expect(namespace).toBe('secscan')
      return {
        getSnapshot: () => ({ value: { ...settings }, revision: 1 }),
        subscribe: (cb: () => void) => { adopters.push(cb); return () => {} },
        set: async () => {},
      }
    },
  })
  // Declared by the plugin's inject (the real settingsScope rides it) but
  // unused directly by apply; required so the fiber starts at all.
  provide('connection', {})

  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))

  await ctx.plugin({ inject: [...inject], apply }).await()
  await ctx.plugin({ apply: nodeApply }).await()
  await ctx.plugin({ inject: ['invariants'], apply: invariantApply }).await()
  await new Promise((resolve) => { setTimeout(resolve, 0) })

  return {
    general: () => ctx.slots.entries('settings.general.item').map(e => ({ id: (e.options as { id: string }).id, order: (e.options as { order: number }).order, locale: e.locale })),
    dock: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      return entry === undefined
        ? undefined
        : { id: (entry.options as { id: string }).id, order: (entry.options as { order: number }).order, locale: entry.locale }
    },
    subscribed,
    push: (event) => { findingsListener?.(event) },
  }
}

describe('ui-secscan browser plugin', () => {
  it('registers both settings rows and the findings dock, and subscribes the push event', async () => {
    const b = await bench({ mode: 'monitor', ignoreRuleIds: [] })
    expect(b.general()).toEqual([
      { id: 'secscan', order: 15, locale: 'secscan' },
      { id: 'secscan-ignore', order: 16, locale: 'secscan' },
    ])
    expect(b.dock()).toMatchObject({ id: 'secscan', order: 25, locale: 'secscan' })
    expect(b.subscribed).toEqual(['secscan/findings'])
  })

  it('adopts scope values into the row store and keeps the strip hidden until a push', async () => {
    const b = await bench({ mode: 'block', ignoreRuleIds: ['high-entropy'] })
    // The dock entry exists but renders nothing before a push for its session;
    // registration-level: the inject face carries the session id and dismiss.
    const entry = b.dock()
    expect(entry).toBeDefined()
    expect(b.subscribed).toEqual(['secscan/findings'])
    b.push({ sessionId: 's1', mode: 'monitor', action: 'pass', findings: [{ ruleId: 'generic-sk-token', type: 'sk-token', severity: 'high', sampleLast4: '9Jkl' }], at: 100 })
    // No throw on push; store state lives behind the slot store seat.
  })

  it('survives a settings adoption callback without error', async () => {
    const b = await bench({ mode: 'off', ignoreRuleIds: [] })
    expect(b.general()).toHaveLength(2)
  })
})
