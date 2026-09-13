/**
 * Findings strip mounted through the conversation.input.dock slot: one amber
 * row above the composer card summarizing the latest `secscan/findings` push
 * for THIS session. Renders nothing until a push arrives for the current
 * session, and hides again once dismissed.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createFindingsStore } from './findings-store.ts'
import css from './secscan.module.css'

/** Injected business face: the current session id and the dismiss verb. */
export interface FindingsDockInjected {
  sessionId: string
  dismiss: (at: number) => void
}

/** Full component props. */
export type FindingsDockComponentProps =
  PropsRuntime<'conversation.input.dock'> & PropsStore<ReturnType<typeof createFindingsStore>>
  & PropsLocale<'secscan'> & FindingsDockInjected

/**
 * Render the findings strip (or nothing).
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FindingsDock({ t, sessionId, dismiss, useStore }: FindingsDockComponentProps) {
  const event = useStore(s => s.event)
  const dismissedAt = useStore(s => s.dismissedAt)
  if (event === null || event.sessionId !== sessionId || event.at <= dismissedAt) return null
  return (
    <div className={css.strip} role="status">
      <span className={css.stripText}>
        {t('secscan.strip.body', { mode: event.mode, count: event.findings.length })}
      </span>
      <button type="button" className={css.dismiss} onClick={() => { dismiss(event.at) }}>
        {t('secscan.strip.dismiss')}
      </button>
    </div>
  )
}
