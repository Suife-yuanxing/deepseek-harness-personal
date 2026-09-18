/** Cross-generation settings-registration bridge behavior. */
import { describe, expect, it } from 'vitest'
import { resolveSettingsNamespace } from '../src/settings-register.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

const NS = 'ui-token-usage'

/** Pre-split API surface: the legacy helper is present. */
function legacyApi() {
  return {
    settingsNamespace: (value: string) => value as SettingsNamespace,
  }
}

/** Post-split API surface (≥0.1.5): the legacy helper is removed. */
function splitApi() {
  return {} as object
}

describe('resolveSettingsNamespace', () => {
  it('routes through the legacy brand helper when the module still has one', () => {
    const result = resolveSettingsNamespace(NS, legacyApi())
    expect(result).toBe(NS)
  })

  it('falls back to the raw namespace string after the split removed the helper', () => {
    const result = resolveSettingsNamespace(NS, splitApi())
    expect(result).toBe(NS)
  })

  it('preserves a branded namespace produced by the legacy helper', () => {
    const branded = Symbol.for('SettingsNamespace')
    const made = { [branded]: true }
    const api = {
      settingsNamespace: () => made as unknown as SettingsNamespace,
    }
    expect(resolveSettingsNamespace(NS, api)).toBe(made)
  })
})
