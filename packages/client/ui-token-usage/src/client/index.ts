/**
 * Token usage settings plugin, browser half. It registers the Token usage
 * section (billing mode, plan catalog, allowance meter, simulation billing)
 * and owns the durable `ui-token-usage` settings scope the section writes
 * through. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { TokenUsageSection } from './TokenUsageSection.tsx'
import type { TokenUsageSectionInjected } from './TokenUsageSection.tsx'
import { TokenUsageController } from './controller.ts'
import { createTokenUsageStore } from './store.ts'
import { en, zh, type TokenUsageKey } from './locales.ts'
import { TOKEN_USAGE_SETTINGS_NAMESPACE, type TokenUsageSettings } from '../token-usage-settings.ts'

export type { TokenUsageSectionInjected, TokenUsageSectionProps } from './TokenUsageSection.tsx'
export type { TokenUsageKey } from './locales.ts'
export type { TokenUsageBill } from './controller.ts'
export type { TokenUsageState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Token usage settings page copy. */
    'settings.tokenUsage': TokenUsageKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.tokenUsage'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply; registration depends on each slot through
 * `slots.inject()`, and the durable scope through `settingsScope`.
 */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Register the Token usage section once the `settings.section` declaration
 * is on the ledger, and bind the durable scope controller to the page store.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-token-usage: copy dictionaries')

  const host = ctx.settingsScope.bind<TokenUsageSettings>({
    namespace: TOKEN_USAGE_SETTINGS_NAMESPACE,
  })
  const store = createTokenUsageStore()
  const controller = new TokenUsageController({ host, store })
  const t = ctx.locale.bind(NS) as TokenUsageSectionInjected['t']

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'token-usage',
    order: 90,
    label: () => t('nav'),
    store,
    inject: (actions: BoundActions<typeof store>): TokenUsageSectionInjected => {
      controller.bind(actions)
      return { controller, t }
    },
  }, TokenUsageSection))
}
