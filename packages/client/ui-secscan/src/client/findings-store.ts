/**
 * Findings-strip store: holds the latest `secscan/findings` push. The plugin's
 * apply-world `$on` listener is the only writer besides the dismiss action.
 * Uses the vendored mini store engine (no runtime import).
 */
import { createMiniStore, type MiniStoreHandle } from './mini-store.ts'
import type { SecscanFindingsEvent } from './secscan-settings.ts'

/** Store state for the per-session findings strip. */
export interface FindingsState {
  /** Latest push, or null before the first one. */
  event: SecscanFindingsEvent | null
  /** Snapshot id dismissed by the user; pushes bump past it. */
  dismissedAt: number
}

/**
 * Declares the findings-strip state and write surface.
 * @returns the store handle.
 */
export function createFindingsStore(): MiniStoreHandle<FindingsState, {
  sync: (draft: FindingsState, event: SecscanFindingsEvent) => void
  dismiss: (draft: FindingsState, at: number) => void
}> {
  return createMiniStore({
    init: (): FindingsState => ({ event: null, dismissedAt: -1 }),
    actions: {
      sync: (d, event: SecscanFindingsEvent) => {
        d.event = event
        if (event.at > d.dismissedAt) d.dismissedAt = -1
      },
      dismiss: (d, at: number) => {
        d.dismissedAt = at
      },
    },
  })
}
