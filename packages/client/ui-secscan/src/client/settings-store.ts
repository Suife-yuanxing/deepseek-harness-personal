/**
 * Settings-row store: a mirror of the `secscan` settings scope. The plugin's
 * apply-world adoption listener is the only writer; row components read via
 * props.useStore. Uses the vendored mini store engine (no runtime import).
 */
import { createMiniStore, type MiniStoreHandle, type MiniStoreInstance } from './mini-store.ts'
import type { SecscanMode } from './secscan-settings.ts'

/** Store state mirrored from the settings scope snapshot. */
export interface SecscanRowState {
  /** Persisted mode (selection state reads this). */
  mode: SecscanMode
  /** Persisted ignore list, already split. */
  ignoreRuleIds: string[]
  /** Adoption counter; -1 until the first sync. */
  revision: number
}

/**
 * Declares the settings-row state and write surface.
 * @returns the store handle.
 */
export function createSecscanRowStore(): MiniStoreHandle<SecscanRowState, {
  sync: (draft: SecscanRowState, mode: SecscanMode, ignoreRuleIds: string[], revision: number) => void
}> {
  return createMiniStore({
    init: (): SecscanRowState => ({ mode: 'monitor', ignoreRuleIds: [], revision: -1 }),
    actions: {
      sync: (d, mode: SecscanMode, ignoreRuleIds: string[], revision: number) => {
        if (revision <= d.revision) return
        d.mode = mode
        d.ignoreRuleIds = [...ignoreRuleIds]
        d.revision = revision
      },
    },
  })
}

export type { MiniStoreInstance }
