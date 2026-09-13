/**
 * SecScan surface plugin, browser half: two General-settings rows (mode
 * cubes, ignore-rule editor) over the `secscan` settings scope, plus the
 * per-session findings strip fed by the host-pushed `secscan/findings`
 * remote event. The durable namespace and the push vocabulary are owned by
 * dsh-secscan-policy; this package only mirrors their wire shapes.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key set.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the `secscan/findings` Events declaration (single source, host face).
import type {} from '@deepseek-ai/dsh-secscan-policy/types'
import { FindingsDock, type FindingsDockInjected } from './FindingsDock.tsx'
import { SecscanIgnoreRow, type SecscanIgnoreRowInjected } from './SecscanIgnoreRow.tsx'
import { SecscanRow, type SecscanRowInjected } from './SecscanRow.tsx'
import { createFindingsStore } from './findings-store.ts'
import { createSecscanRowStore } from './settings-store.ts'
import { DEFAULT_SECSCAN_SETTINGS, SECSCAN_SETTINGS_NAMESPACE, type SecscanFindingsEvent, type SecscanMode, type SecscanSettings } from './secscan-settings.ts'
import { en, zh, type SecscanKey } from './locales.ts'

export { FindingsDock } from './FindingsDock.tsx'
export { SecscanRow } from './SecscanRow.tsx'
export { SecscanIgnoreRow } from './SecscanIgnoreRow.tsx'
export type { SecscanKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The SecScan rows' and strip's copy. */
    secscan: SecscanKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'secscan'

/** Required services: slots, copy, the api transport, remote events, and the settings scope. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/** Monotonic adoption counter so the store's revision guard drops stale dupes. */
let adoption = 0

/**
 * Client plugin body: the two settings rows and the findings dock.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<SecscanSettings>({ namespace: SECSCAN_SETTINGS_NAMESPACE })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-secscan: dictionaries')

  // Settings rows: the scope is the source of truth; the store mirror is
  // written through the inject face's bound actions (populated on first
  // render — the adopt() re-run there recovers events fired before that).
  const rowStore = createSecscanRowStore()
  let rowBound: BoundActions<typeof rowStore> | undefined
  const adopt = (): void => {
    const snap = scope.getSnapshot().value
    adoption += 1
    rowBound?.sync(
      snap?.mode ?? DEFAULT_SECSCAN_SETTINGS.mode,
      snap?.ignoreRuleIds ?? DEFAULT_SECSCAN_SETTINGS.ignoreRuleIds,
      adoption,
    )
  }
  ctx.effect(() => scope.subscribe(adopt), 'ui-secscan: settings adoption')
  const rowInject = (actions: BoundActions<typeof rowStore>): SecscanRowInjected => {
    rowBound = actions
    adopt()
    return { setMode: (id: SecscanMode) => { void scope.set('mode', id) } }
  }
  const ignoreInject = (actions: BoundActions<typeof rowStore>): SecscanIgnoreRowInjected => {
    rowBound = actions
    adopt()
    return { setIgnore: (ids: string[]) => { void scope.set('ignoreRuleIds', ids) } }
  }

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'secscan',
    order: 15,
    store: rowStore,
    locale: NS,
    inject: rowInject,
  }, SecscanRow))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'secscan-ignore',
    order: 16,
    store: rowStore,
    locale: NS,
    inject: ignoreInject,
  }, SecscanIgnoreRow))

  // Findings strip: the push is the source of truth. The latest event is kept
  // so a strip mounted AFTER its session's push still replays it.
  const dockStore = createFindingsStore()
  let dockBound: BoundActions<typeof dockStore> | undefined
  let lastEvent: SecscanFindingsEvent | undefined
  ctx.remote.$on('secscan/findings', (event) => {
    lastEvent = event
    dockBound?.sync(event)
  })
  const dockInject = (sessionId: string, actions: BoundActions<typeof dockStore>): FindingsDockInjected => {
    dockBound = actions
    if (lastEvent !== undefined && lastEvent.sessionId === sessionId) actions.sync(lastEvent)
    return { sessionId, dismiss: (at: number) => { actions.dismiss(at) } }
  }

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'secscan',
    order: 25,
    store: dockStore,
    locale: NS,
    inject: dockInject,
  }, FindingsDock))
}
