/**
 * Findings-strip store: holds the latest `secscan/findings` push. The plugin's
 * apply-world `$on` listener is the only writer besides the dismiss action.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
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
export function createFindingsStore(): EngineStoreHandle<FindingsState, {
  sync: (draft: FindingsState, event: SecscanFindingsEvent) => void
  dismiss: (draft: FindingsState, at: number) => void
}> {
  return defineStore({
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
