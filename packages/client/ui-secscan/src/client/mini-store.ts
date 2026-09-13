/**
 * Minimal vendored store engine: the slots store contract (spec + create)
 * implemented locally so the client bundle carries no cross-plugin runtime
 * import. The frozen module table of older shells does not serve the runtime
 * store engine, and the bundle purity gate forbids inlining it — a ~30-line
 * subscribe/set engine over plain state satisfies both. Persistence is not
 * needed (settings live in the host document; pushes are transient). The
 * contract TYPES ride the platform ui-slots face as type-only imports.
 */
import type { ActionsDecl, BakedActions } from '@deepseek-ai/dsh-client-ui-slots'

/** Live instance: the contract face the slots renderer consumes. */
export interface MiniStoreInstance<T, A extends ActionsDecl<T>> {
  readonly actions: BakedActions<T, A>
  getSnapshot(): T
  subscribe(fn: () => void): () => void
  clearPersisted(): void
}

/** Handle: the registration currency of the slots store seat. */
export interface MiniStoreHandle<T, A extends ActionsDecl<T>> {
  readonly spec: { init: () => T; actions: A }
  create(scopeKey?: string): MiniStoreInstance<T, A>
}

/**
 * Declare a store handle: fresh state per instance, draft-mutating actions
 * baked onto a cloned draft (state shapes here are small plain objects).
 * The `A & ActionsDecl<T>` actions position is load-bearing: T resolves from
 * `init` in the first inference round, and the intersection then contextually
 * types each mutator's draft parameter.
 * @param decl - init lambda plus the actions table.
 * @returns the store handle.
 */
export function createMiniStore<T extends object, A extends ActionsDecl<T>>(
  decl: { init: () => T; actions: A & ActionsDecl<T> },
): MiniStoreHandle<T, A> {
  const rawActions = decl.actions as Record<string, (draft: T, ...params: never[]) => void>
  return {
    spec: { init: decl.init, actions: decl.actions as A },
    create() {
      let state = decl.init()
      const listeners = new Set<() => void>()
      const notify = (): void => {
        for (const fn of [...listeners]) fn()
      }
      // oxlint-disable-next-line typescript/no-explicit-any -- the baked face erases the draft parameter by construction
      const baked = {} as Record<string, (...params: any[]) => void>
      for (const [key, action] of Object.entries(rawActions)) {
        // oxlint-disable-next-line typescript/no-explicit-any -- the baked face erases the draft parameter by construction
        const run = action as unknown as (draft: T, ...params: any[]) => void
        // oxlint-disable-next-line typescript/no-explicit-any -- the baked face erases the draft parameter by construction
        baked[key] = (...params: any[]): void => {
          const draft = structuredClone(state)
          run(draft, ...params)
          state = draft
          notify()
        }
      }
      return {
        actions: baked as MiniStoreInstance<T, A>['actions'],
        getSnapshot: () => state,
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        clearPersisted: () => {},
      }
    },
  }
}
