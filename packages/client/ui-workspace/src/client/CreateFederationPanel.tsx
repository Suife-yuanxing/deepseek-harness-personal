/**
 * Create-federation panel: the modal behind the pick menu's "New federation"
 * action. Members are picked from the registered workspaces (paths already
 * host-validated), the check order fixes the member order, and each checked
 * row offers a promote-to-primary button. The title defaults to the members'
 * basenames joined with ' + ' and is recomputed on membership changes until
 * the user types into it. Panel state is instance-local: raising the panel
 * remounts it, so a discarded attempt never leaks into the next one.
 */
import { useMemo, useState } from 'react'
import {
  Button, IconCheckOutline16, Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FederationView, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import clsx from 'clsx'
import type { WorkspacePickerProps } from './contract/slots.ts'
import css from './Federations.module.css'

interface CreateFederationPanelProps {
  /** Host carrier that validates members and persists the federation. */
  createFederation: (input: { title?: string; memberPaths: string[] }) => Promise<FederationView>
  /** Registered workspaces offered as federation members. */
  workspaces: readonly WorkspaceView[]
  /** Locale seat forwarded by the hosting flow. */
  t: WorkspacePickerProps['t']
  /** Close without creating (footer cancel / outside click / Escape). */
  onClose: () => void
}

/**
 * Render the member-picking modal.
 * @param props - carrier, member source, locale seat, and close callback.
 * @returns the modal element (always open; unmounting hides it).
 */
export function CreateFederationPanel({
  createFederation,
  workspaces,
  t,
  onClose,
}: CreateFederationPanelProps) {
  // Selection order IS the member order: appending checks in order and
  // promoting moves one member to index 0 with the rest keeping their
  // relative order. Stale ids (a workspace deleted elsewhere mid-panel) stay
  // selected but drop out of the member projection at read time.
  const [selectedIds, setSelectedIds] = useState<readonly WorkspaceId[]>([])
  const [titleTouched, setTitleTouched] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const byId = useMemo(
    () => new Map(workspaces.map(workspace => [workspace.workspaceId, workspace] as const)),
    [workspaces],
  )
  const members = selectedIds.flatMap((id) => {
    const workspace = byId.get(id)
    return workspace === undefined ? [] : [{ id, path: workspace.path }]
  })
  // An untouched field follows the current member set; a touched one keeps
  // the user's draft exactly (they may want the stale text trimmed later).
  const defaultTitle = members.map(member => basenameOf(member.path)).join(' + ')
  const effectiveTitle = titleTouched ? titleDraft : defaultTitle
  const enoughMembers = members.length >= 2

  const toggle = (id: WorkspaceId): void => {
    setSelectedIds(current => current.includes(id)
      ? current.filter(entry => entry !== id)
      : [...current, id])
  }
  /** Move one checked member to index 0; the others keep their relative order. */
  const promoteToPrimary = (id: WorkspaceId): void => {
    setSelectedIds(current => [id, ...current.filter(entry => entry !== id)])
  }

  /** Submit to the carrier; business failures land inline below the list. */
  const confirm = (): void => {
    // Defense-in-depth behind the footer button's disabled attribute: testing
    // library and browsers both refuse clicks on a disabled control, so no
    // mounted-UI path reaches the early return with members short or pending.
    /* v8 ignore next -- unreachable through the rendered affordance; kept as
       the code-level enforcement that the enable state is not trusted. */
    if (!enoughMembers || pending) return
    setPending(true)
    setError(null)
    createFederation({
      ...(effectiveTitle === '' ? {} : { title: effectiveTitle }),
      memberPaths: members.map(member => member.path),
    }).then(() => {
      setPending(false)
      onClose()
    }).catch((reason: unknown) => {
      setPending(false)
      // The carrier rejects with Error subclasses only (the typed
      // FederationCreateError); any other value is outside the contract.
      /* v8 ignore next -- the non-Error branch exists for a foreign
         reimplementation of the callback, unreachable under this face. */
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('federation.panel.title')}
      footer={(
        <>
          {!enoughMembers && <span className={css.panelHint}>{t('federation.panel.hint')}</span>}
          <Button variant="outline" className={css.modalAction} disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" className={css.modalAction} disabled={!enoughMembers || pending} onClick={confirm}>
            {t('federation.panel.confirm')}
          </Button>
        </>
      )}
    >
      {/* The wrapper owns spacing: the Input atom's exact-optional className
          member rejects a possibly-unset index access under strict flags. */}
      <div className={css.titleField}>
        <Input
          placeholder={t('federation.field.title')}
          value={effectiveTitle}
          aria-label={t('federation.field.title')}
          onChange={(event) => {
            setTitleTouched(true)
            setTitleDraft(event.target.value)
          }}
        />
      </div>
      <div className={css.memberList} role="group">
        {workspaces.length === 0 && <div className={css.memberPath}>{t('empty.none')}</div>}
        {workspaces.map((workspace) => {
          const position = members.findIndex(member => member.id === workspace.workspaceId)
          const checked = position >= 0
          return (
            <div key={workspace.workspaceId} className={css.memberRow}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                className={css.memberToggle}
                onClick={() => { toggle(workspace.workspaceId) }}
              >
                <span className={clsx(css.checkbox, checked && css.checked)}>
                  {checked && <IconCheckOutline16 size={12} />}
                </span>
                <span className={css.memberText}>
                  <span className={css.memberTitle}>{workspace.title}</span>
                  <span className={css.memberPath}>{workspace.path}</span>
                </span>
              </button>
              {checked && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={css.primaryAction}
                  disabled={position === 0}
                  onClick={() => { promoteToPrimary(workspace.workspaceId) }}
                >
                  {t('federation.panel.primary')}
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {error !== null && <div className={css.inlineError} role="alert">{error}</div>}
    </Modal>
  )
}

/** Everything after the last path separator (Windows and POSIX forms). */
function basenameOf(path: string): string {
  const tail = path.split(/[\\/]/).pop()
  /* v8 ignore next -- split on any separator always yields at least one
     element, so pop() cannot miss; the arm guards only a hypothetical empty
     path that member projection never passes. */
  return tail ?? ''
}
