/**
 * Cross-generation settings-namespace registration bridge. The dsh-settings
 * metadata split (≥0.1.5) removed `settingsNamespace()`: `register()` accepts
 * the raw lowercase-hyphenated namespace string, whose validity is enforced
 * in the type system. Pre-split Hosts (≤0.1.0-rc.5) still require the
 * `SettingsNamespace` brand the legacy helper produced. Probing the runtime
 * module for the legacy helper picks the equivalent registration call for
 * each generation, so one package serves both Host API shapes.
 */

import * as settingsApi from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/**
 * Resolve one namespace value into what the active dsh-settings generation's
 * `register()` accepts: the brand on pre-split Hosts, the plain string after
 * the split.
 * @param value - the lowercase-hyphenated namespace.
 * @param api - the dsh-settings module surface (injectable for specs).
 * @returns the namespace argument the active generation registers.
 */
export function resolveSettingsNamespace(
  value: string,
  api: object = settingsApi,
): SettingsNamespace {
  const make = (api as { settingsNamespace?: (value: string) => SettingsNamespace }).settingsNamespace
  return make === undefined ? value as SettingsNamespace : make(value)
}
