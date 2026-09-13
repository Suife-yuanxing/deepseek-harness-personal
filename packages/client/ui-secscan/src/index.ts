/** Host registration for the SecScan settings rows and findings strip. The
 * durable settings namespace itself is installed by dsh-secscan-policy; this
 * half exists so the Loader can compose and serve the browser bundle.
 * @module @deepseek-ai/dsh-client-ui-secscan
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * No Host-side behavior: every durable concern (settings namespace, event
 * vocabulary, audit) is owned by `dsh-secscan-policy`.
 * @param _ctx - Host context (unused).
 */
export function apply(_ctx: Context): void {}
