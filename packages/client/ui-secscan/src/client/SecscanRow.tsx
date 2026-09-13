/**
 * Mode row registered into the General section item slot: title + four mode
 * cubes + a per-mode description. Registered by this package — the SecScan
 * feature owns its settings surface; the durable section lives in the
 * `secscan` namespace installed by dsh-secscan-policy.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSecscanRowStore } from './settings-store.ts'
import { SECSCAN_MODES, type SecscanMode } from './secscan-settings.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './secscan.module.css'

/** Injected business face: the mode write (t rides the standard locale seat). */
export interface SecscanRowInjected {
  /** Switch the policy mode. */
  setMode: (id: SecscanMode) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type SecscanRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createSecscanRowStore>>
  & PropsLocale<'secscan'> & SecscanRowInjected

/**
 * Render the mode row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function SecscanRow({ t, setMode, useStore }: SecscanRowComponentProps) {
  const mode = useStore(s => s.mode)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('secscan.mode.title')}</div>
      <div className={css.cubeRow}>
        {SECSCAN_MODES.map(id => (
          <button
            key={id}
            type="button"
            className={clsx(css.modeCube, mode === id && css.selected)}
            aria-pressed={mode === id}
            onClick={() => { setMode(id) }}
          >
            {t(`secscan.mode.${id}`)}
          </button>
        ))}
      </div>
      <div className={css.desc}>{t(`secscan.desc.${mode}`)}</div>
    </div>
  )
}
