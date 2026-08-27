// Federated-roots chip: the multi-root marker above the composer for
// federated sessions. Data rides the global sessions list row (the host's
// header passthrough), and an ordinary single-root session renders nothing —
// the plain-session regression red line.

import { memo } from 'react'
import type { ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './FederatedRootsChip.module.css'

/** Full dock-entry props; the chip reads the global seat and the locale seat only. */
export type FederatedRootsChipProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'conversation'>

/**
 * Stacked-folders glyph in its miniature form: two offset rounded rectangles
 * carrying the multi-root semantics. Mirrored locally from ui-workspace's
 * menu icon (cross-package component imports are forbidden both ways).
 */
function StackedFoldersMini(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="1.5" width="10" height="9" rx="1.5" fill="currentColor" opacity={0.45} />
      <rect x="2.5" y="4.5" width="10" height="9" rx="1.5" fill="currentColor" />
    </svg>
  )
}

/** Everything after the last path separator (Windows and POSIX forms). */
function basenameOf(path: string): string {
  const tail = path.split(/[\\/]/).pop()
  return tail ?? ''
}

/**
 * Tooltip lines listing every root, the primary (cwd) first and marked.
 * Exported pure so tests pin the member-list wording without hover synthesis.
 * @param cwd - the session's working directory (the primary root); omitted drops the marked first line.
 * @param additionalRoots - the extra canonical roots in order.
 * @param primaryMark - locale word marking the primary line.
 * @returns one basename per line joined with newlines.
 */
export function federatedRootsLines(
  cwd: string | undefined,
  additionalRoots: readonly string[],
  primaryMark: string,
): string {
  return [
    ...(cwd !== undefined ? [`${primaryMark} ${basenameOf(cwd)}`] : []),
    ...additionalRoots.map(path => basenameOf(path)),
  ].join('\n')
}

/**
 * Render the multi-root marker, or null for ordinary sessions.
 * @param props - the dock owner share (unused) plus the global session-list
 *   seat and the locale seat.
 * @returns the chip element or null.
 */
export const FederatedRootsChip = memo(function FederatedRootsChip({ useSessions, t }: FederatedRootsChipProps) {
  // The current row is authoritative for this session-scoped surface: a
  // federated session carries the additional roots from creation forward,
  // while single-root rows omit the field entirely (no chip).
  const row = useSessions(state => state.current === undefined ? undefined : state.byId[state.current])
  if (row?.additionalRoots === undefined || row.additionalRoots.length === 0) return null
  const memberCount = row.additionalRoots.length + 1
  return (
    <Tooltip label={federatedRootsLines(row.cwd, row.additionalRoots, t('roots.chip.primary'))} side="top" delayMs={500}>
      <span className={css.root}>
        <StackedFoldersMini />
        <span className={css.badge}>×{memberCount}</span>
      </span>
    </Tooltip>
  )
})
