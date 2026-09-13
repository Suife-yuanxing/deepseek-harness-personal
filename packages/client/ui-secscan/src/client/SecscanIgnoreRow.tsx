/**
 * Ignore-rule editor row: a single text input holding the comma-separated
 * ruleId list. Writes go through the injected face on blur/Enter; the store
 * is re-adopted from the settings scope once the write lands.
 */
import { useEffect, useState } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSecscanRowStore } from './settings-store.ts'
import css from './secscan.module.css'

/** Injected business face: the ignore-list write. */
export interface SecscanIgnoreRowInjected {
  /** Replace the ignored-ruleId list. */
  setIgnore: (ids: string[]) => void
}

/** Full component props. */
export type SecscanIgnoreRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createSecscanRowStore>>
  & PropsLocale<'secscan'> & SecscanIgnoreRowInjected

/** Split the editable text into the durable list: comma/whitespace separated, unique. */
function parseIds(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(/[,\s]+/)) {
    const id = raw.trim()
    if (id.length > 0) seen.add(id)
  }
  return [...seen]
}

/**
 * Render the ignore-rule editor row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function SecscanIgnoreRow({ t, setIgnore, useStore }: SecscanIgnoreRowComponentProps) {
  const ignoreRuleIds = useStore(s => s.ignoreRuleIds)
  const [text, setText] = useState(ignoreRuleIds.join(', '))
  useEffect(() => { setText(ignoreRuleIds.join(', ')) }, [ignoreRuleIds])
  const commit = (): void => { setIgnore(parseIds(text)) }
  return (
    <div className={css.group}>
      <div className={css.title}>{t('secscan.ignore.title')}</div>
      <Input
        value={text}
        placeholder={t('secscan.ignore.hint')}
        onChange={(e) => { setText(e.target.value) }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } }}
      />
      <div className={css.hint}>{t('secscan.ignore.hint')}</div>
    </div>
  )
}
