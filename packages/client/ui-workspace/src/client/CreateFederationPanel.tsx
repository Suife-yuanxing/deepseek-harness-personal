/**
 * Create-federation panel: the modal behind the pick menu's "New federation"
 * action. Members come from two sources — the registered workspaces (paths
 * already host-validated, check order fixes the member order) and free host
 * directories added through this surface's directory flow, where the occupant
 * hands back a raw path with no workspace registration involved. Folder
 * members cannot become the primary: a claim attaches the session to the
 * PRIMARY member's registered workspace, so promotion stays workspace-only.
 * Exact-duplicate paths are refused inline at add time; a canonically equal
 * path under another spelling still reaches the Host and comes back as
 * `federation-invalid-members` in the same inline slot. The title defaults to
 * the members' basenames joined with ' + ' and is recomputed on membership
 * changes until the user types into it. Panel state is instance-local:
 * raising the panel remounts it, so a discarded attempt never leaks into the
 * next one.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconCheckOutline16, IconPlusOutline16, Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FederationView, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import clsx from 'clsx'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from './contract/slots.ts'
import css from './Federations.module.css'

/** One draft member: a registered workspace or a free folder path. */
interface MemberDraft {
  /** Stable identity for toggle/promote/dedup: the workspaceId, else `folder:<path>`. */
  readonly key: string
  /** Absolute path submitted to the carrier. */
  readonly path: string
  /** Row label: the workspace title, else the folder basename. */
  readonly title: string
  /** Present only for workspace-sourced members; folder members never promote. */
  readonly workspaceId?: WorkspaceId
}

interface CreateFederationPanelProps {
  /** Host carrier that validates members and persists the federation. */
  createFederation: (input: { title?: string; memberPaths: string[] }) => Promise<FederationView>
  /** Registered workspaces offered as federation members. */
  workspaces: readonly WorkspaceView[]
  /** Whether this surface's directory-flow hole is occupied; without it the free-folder route does not exist. */
  flowAvailable: boolean
  /** Render this surface's directory-flow hole; the panel is its owner while a pick is up. */
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => ReactNode
  /** Locale seat forwarded by the hosting flow. */
  t: WorkspacePickerProps['t']
  /** Close without creating (footer cancel / outside click / Escape). */
  onClose: () => void
}

/**
 * Render the member-picking modal.
 * @param props - carrier, member sources, flow seat, locale seat, and close callback.
 * @returns the modal element (always open; unmounting hides it).
 */
export function CreateFederationPanel({
  createFederation,
  workspaces,
  flowAvailable,
  renderDirectoryFlow,
  t,
  onClose,
}: CreateFederationPanelProps) {
  // Member state is append-ordered: a workspace check and a folder addition
  // both append, and promotion moves one member to index 0 with the rest
  // keeping their relative order. Workspace rows snapshot title/path at check
  // time; folder rows are their own source of truth.
  const [members, setMembers] = useState<readonly MemberDraft[]>([])
  const [titleTouched, setTitleTouched] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [flowOpen, setFlowOpen] = useState(false)

  const byId = useMemo(
    () => new Map(workspaces.map(workspace => [workspace.workspaceId, workspace] as const)),
    [workspaces],
  )
  // Read-time projection: a checked workspace whose registration vanished
  // mid-panel drops out here (its snapshot id no longer resolves), exactly
  // like the pre-folder model; folder members have nothing to go stale.
  const projected = members.filter(
    member => member.workspaceId === undefined || byId.has(member.workspaceId),
  )
  // An untouched field follows the current member set; a touched one keeps
  // the user's draft exactly (they may want the stale text trimmed later).
  const defaultTitle = projected.map(member => basenameOf(member.path)).join(' + ')
  const effectiveTitle = titleTouched ? titleDraft : defaultTitle
  const enoughMembers = projected.length >= 2
  const folderMembers = projected.filter(member => member.workspaceId === undefined)

  const toggleWorkspace = (workspace: WorkspaceView): void => {
    setError(null)
    setMembers(current => current.some(member => member.key === workspace.workspaceId)
      ? current.filter(member => member.key !== workspace.workspaceId)
      : [...current, {
        key: workspace.workspaceId,
        path: workspace.path,
        title: workspace.title,
        workspaceId: workspace.workspaceId,
      }])
  }
  /** Remove one free-folder member (the folder row's toggle-off gesture). */
  const removeMember = (key: string): void => {
    setError(null)
    setMembers(current => current.filter(member => member.key !== key))
  }
  /** Move one checked workspace to index 0; the others keep their relative order. */
  const promoteToPrimary = (key: string): void => {
    setMembers((current) => {
      const member = current.find(entry => entry.key === key)
      // Folders never promote: the primary anchors the session claim to its
      // registered workspace, which a free path does not have.
      if (member === undefined || member.workspaceId === undefined) return current
      return [member, ...current.filter(entry => entry.key !== key)]
    })
  }

  /**
   * Owner side of the panel's directory-flow conversation. Adoption is a
   * synchronous state append, so the flow never needs its busy phase: every
   * outcome closes the flow and either lands the member or surfaces the
   * failure inline like any other panel error. Handlers rebuild each render,
   * and the flow occupant reports through the latest ones, so the duplicate
   * check always reads the current member set.
   */
  const flowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy: false,
    onPicked: (path) => {
      setFlowOpen(false)
      if (members.some(member => member.path === path)) {
        setError(t('federation.panel.duplicateMember'))
        return
      }
      setError(null)
      setMembers(current => [...current, { key: `folder:${path}`, path, title: basenameOf(path) }])
    },
    onCancel: () => { setFlowOpen(false) },
    onError: (message) => {
      setFlowOpen(false)
      setError(message)
    },
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
      memberPaths: projected.map(member => member.path),
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
    <>
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
          {/* With a flow occupant the empty registry is no longer a dead end:
              free folders alone can fill the member set. The text only shows
              when NO member source exists at all. */}
          {workspaces.length === 0 && !flowAvailable && <div className={css.memberPath}>{t('empty.none')}</div>}
          {workspaces.map((workspace) => {
            const member = members.find(entry => entry.workspaceId === workspace.workspaceId)
            const checked = member !== undefined
            // The list's presence probe flagged this directory as gone: the
            // Host would reject the create (`federation-invalid-members`), so
            // the row is unselectable and says why.
            const missing = workspace.missing === true
            return (
              <div key={workspace.workspaceId} className={css.memberRow}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  className={css.memberToggle}
                  disabled={missing}
                  onClick={() => { toggleWorkspace(workspace) }}
                >
                  <span className={clsx(css.checkbox, checked && css.checked)}>
                    {checked && <IconCheckOutline16 size={12} />}
                  </span>
                  <span className={css.memberText}>
                    <span className={css.memberTitle}>{workspace.title}</span>
                    <span className={css.memberPath}>{workspace.path}</span>
                    {missing && <span className={css.memberMissing}>{t('federation.missingHint')}</span>}
                  </span>
                </button>
                {checked && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={css.primaryAction}
                    disabled={members[0]?.key === workspace.workspaceId}
                    onClick={() => { promoteToPrimary(workspace.workspaceId) }}
                  >
                    {t('federation.panel.primary')}
                  </Button>
                )}
              </div>
            )
          })}
          {(folderMembers.length > 0 || flowAvailable) && workspaces.length > 0
            && <div className={css.sectionDivider} role="presentation" />}
          {folderMembers.map(member => (
            <div key={member.key} className={css.memberRow}>
              <button
                type="button"
                role="checkbox"
                aria-checked
                className={css.memberToggle}
                onClick={() => { removeMember(member.key) }}
              >
                <span className={clsx(css.checkbox, css.checked)}>
                  <IconCheckOutline16 size={12} />
                </span>
                <span className={css.memberText}>
                  <span className={css.memberTitle}>{member.title}</span>
                  <span className={css.memberPath}>{member.path}</span>
                </span>
              </button>
              {/* Disabled with its reason on the tooltip: promoting a folder
                  would fabricate a claim primary no registered workspace
                  anchors, which the wire refuses. */}
              <Button
                variant="ghost"
                size="sm"
                className={css.primaryAction}
                disabled
                title={t('federation.panel.folderPrimaryHint')}
              >
                {t('federation.panel.primary')}
              </Button>
            </div>
          ))}
          {flowAvailable && (
            <button
              type="button"
              className={css.addFolderRow}
              onClick={() => { setError(null); setFlowOpen(true) }}
            >
              <IconPlusOutline16 size={14} />
              <span>{t('federation.panel.addFolder')}</span>
            </button>
          )}
        </div>
        {error !== null && <div className={css.inlineError} role="alert">{error}</div>}
      </Modal>
      {renderDirectoryFlow(flowOwner)}
    </>
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
