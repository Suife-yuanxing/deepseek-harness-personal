/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-secscan`.
 * @module @deepseek-ai/dsh-client-ui-secscan/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-secscan'

/** Cordis companion plugin name. */
export const name = 'client-ui-secscan-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the settings rows mirror the `secscan` settings scope
 * through its subscribe/getSnapshot surface, and the findings strip renders
 * only JSON-safe push payloads. Registration wiring is covered directly by
 * this package's client registration spec.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
