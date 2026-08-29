/**
 * Workspace pick/add flow. WorkspacePickFlow is the reusable core (menu +
 * path error dialog) consumed directly by WorkspaceBrowser (same package) and
 * wrapped by WorkspacePicker for the conversation empty-state slot
 * registration. Directory picking itself lives in the composed flow package's
 * slot occupant (see the contract module doc): this core only opens the flow,
 * adopts the picked path, and owns the error surface. Adding a workspace has
 * exactly one route — pick a host directory, new or existing — because the
 * occupant's own create-folder affordance already covers creating one.
 *
 * Federations render after the regular workspaces when the deployment's gray
 * switch is on: stacked-folders icon rows with a member-count capsule and a
 * hover tooltip listing every member (the first marked primary). Picking one
 * claims the federation identity server-side; the "New federation…" action
 * raises the create panel. Everything routes through the injected carrier —
 * no sessions-object knowledge in this package.
 */
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button, IconFolderClose16, IconPlusOutline16, Menu, Modal, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FederationId, FederationView, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from './contract/slots.ts'
import { CreateFederationPanel } from './CreateFederationPanel.tsx'
import cssFlow from './WorkspacePicker.module.css'
import cssFed from './Federations.module.css'

const ADD_WORKSPACE = '::add-workspace'
/** Menu-entry key prefix disambiguating federation rows from workspace ids. */
const FEDERATION_PREFIX = '::federation:'
const ADD_FEDERATION = '::add-federation'

/**
 * Stacked-folders glyph: two offset rounded rectangles carrying the
 * multi-root semantics of a federation row. Per-instance (not a shared
 * icon-library export) because the two-plane offset is this feature's visual.
 * Exported for the browser's federation management rows (same package).
 */
export function StackedFoldersIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="1.5" width="10" height="9" rx="1.5" fill="currentColor" opacity={0.45} />
      <rect x="2.5" y="4.5" width="10" height="9" rx="1.5" fill="currentColor" />
    </svg>
  )
}

/** Tooltip lines: every member path basename, the primary root first and marked. */
export function federationTooltipLines(federation: FederationView, t: WorkspacePickFlowProps['t']): string {
  return federation.memberPaths
    .map((path, index) => index === 0 ? `${t('federation.panel.primary')} ${basenameOf(path)}` : basenameOf(path))
    .join('\n')
}

/** One federation menu row: stacked-folders icon, tooltip-bearing label node, count capsule. */
function federationEntry(federation: FederationView, t: WorkspacePickFlowProps['t'], disabled: boolean): MenuEntry {
  return {
    id: `${FEDERATION_PREFIX}${federation.federationId}`,
    label: (
      <span className={cssFed.fedLabel} title={federationTooltipLines(federation, t)}>
        <span className={cssFed.fedTitle}>{federation.title}</span>
        <span className={cssFed.fedBadge}>×{federation.memberPaths.length}</span>
      </span>
    ),
    icon: <StackedFoldersIcon />,
    disabled,
  }
}

/** Everything after the last path separator (Windows and POSIX forms). */
export function basenameOf(path: string): string {
  const tail = path.split(/[\\/]/).pop()
  return tail ?? ''
}

/** Core flow props: the owner supplies popover control and pick semantics. */
export interface WorkspacePickFlowProps {
  /** The standard locale seat, forwarded by whichever slot entry hosts the flow. */
  t: WorkspacePickerProps['t']
  /** Popover visibility (anchor button toggle state, owner-local). */
  open: boolean
  /** The anchor button element — the popover's placement anchor. */
  anchorRef?: RefObject<HTMLElement | null> | undefined
  /** Selector hook over the workspace list (framework standard hook). */
  useWorkspaces: <S>(selector: (state: WorkspaceListState) => S) => S
  /** Adopt a picked host directory as a real Workspace. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  /** Host carrier that validates members and persists a new federation. */
  createFederation: WorkspacePickerProps['createFederation']
  /** Start (and open) a session claimed from a durable federation identity. */
  startFederatedSession: WorkspacePickerProps['startFederatedSession']
  /** Bound occupancy selector hook for this surface's directory-flow hole (empty leaves the surface with no add action). */
  useDirectoryFlow: SnapshotSelectorHook<boolean>
  /** Render this surface's directory-flow hole with the owner conversation (the entry's narrowed renderSlot). */
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => ReactNode
  /** A real Workspace was picked or created. */
  onPick: (workspaceId: WorkspaceId) => void
  /** Close the popover (outside click / Escape / post-pick). */
  onClose: () => void
  /** Only offer the add action, hide existing workspaces. */
  addOnly?: boolean
  /** Menu opening direction relative to the anchor. */
  side?: 'bottom' | 'top' | 'right'
  /** Currently active workspace (trailing check in the picker list). */
  selectedId?: WorkspaceId | undefined
}

/**
 * Render the pick menu plus the adoption error dialog.
 * @param props - owner-controlled flow props.
 * @returns menu + dialog elements.
 */
export function WorkspacePickFlow({
  t,
  open,
  anchorRef,
  useWorkspaces,
  createWorkspace,
  createFederation,
  startFederatedSession,
  useDirectoryFlow,
  renderDirectoryFlow,
  onPick,
  onClose,
  addOnly = false,
  side = 'bottom',
  selectedId,
}: WorkspacePickFlowProps) {
  const workspaceSnapshot = useWorkspaces(state => state)
  const workspaces = workspaceSnapshot.items
  const federations = workspaceSnapshot.federations
  // Gray switch gates only creation/affordances: durable federations resolve
  // regardless, but a disabled deployment hides both the rows and the panel
  // action so the menu cannot offer what the Host would refuse to serve.
  const federationsShown = workspaceSnapshot.federatedWorkspacesEnabled && !addOnly
  const getAnchorRect = useCallback(
    () => anchorRef?.current?.getBoundingClientRect() ?? null,
    [anchorRef],
  )
  const [errorOpen, setErrorOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  // The dialog title follows the failing carrier: folder adoption vs
  // federated-session claim produce different user-facing headings.
  const [errorContext, setErrorContext] = useState<'folder' | 'federation'>('folder')
  const [flowOpen, setFlowOpen] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [createPanelOpen, setCreatePanelOpen] = useState(false)
  // One picking interaction at a time: while the flow is open (native chooser
  // pending, browse dialog up) or its pick is being adopted, every other
  // menu action stays disabled — a late outcome must not race a concurrent
  // selection or adoption.
  const flowBusy = flowOpen || pickingFolder

  // The occupied hole gates the picking affordance: with no composed flow the
  // entry simply is not there (the seam's documented no-flow default). The
  // framework-bound hook keeps occupancy live: flow plugins activate (and
  // HMR-reload) independently of this menu's renders.
  const flowAvailable = useDirectoryFlow(occupied => occupied)
  // An occupant that unloads mid-interaction leaves nobody to cancel: an
  // open flow over an empty hole withdraws so the menu actions come back.
  // flowOpen is a dependency because the flow can also OPEN over an already
  // empty hole (Choose again after the occupant unloaded with the error
  // dialog up) — that transition must snap back too, not just occupancy loss.
  useEffect(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false)
  }, [flowOpen, flowAvailable])
  const addEntries: MenuEntry[] = [
    ...(flowAvailable ? [{ id: ADD_WORKSPACE, label: t('menu.addWorkspace'), icon: <IconPlusOutline16 size={16} />, disabled: flowBusy } satisfies MenuEntry] : []),
    // The create panel needs no directory-flow occupant; it rides this
    // package's own modal entirely.
    ...(federationsShown ? [{ id: ADD_FEDERATION, label: t('federation.action.create'), disabled: flowBusy } satisfies MenuEntry] : []),
  ]
  // With workspaces listed, the add actions pin below the scroll region
  // (divider + always visible); otherwise they ARE the menu. Regular
  // workspace rows stay ahead of the federation rows (the pick-flow order).
  const rows: MenuEntry[] = [
    ...workspaces.map(workspace => ({
      id: workspace.workspaceId,
      label: workspace.title,
      icon: <IconFolderClose16 size={16} />,
      disabled: flowBusy,
    }) satisfies MenuEntry),
    ...(federationsShown ? federations.map(federation => federationEntry(federation, t, flowBusy)) : []),
  ]
  const pinAdd = !addOnly && rows.length > 0
  const items: MenuEntry[] = pinAdd ? rows : addEntries
  // Nothing listed and nothing to add with (a composition that mounts this
  // package without any directory-picker): an empty popover would claim a
  // choice that does not exist, so the anchor gesture shows nothing at all.
  const menuIsEmpty = items.length === 0

  const closeModal = (): void => {
    setErrorOpen(false)
    setModalError(null)
  }

  /** Adopt a picked directory; failures land in the folder-error dialog (Choose again reopens the flow). */
  const adoptDirectory = (path: string): Promise<void> =>
    createWorkspace({ path }).then((workspace) => {
      setFlowOpen(false)
      onPick(workspace.workspaceId)
    }).catch((reason: unknown) => {
      setErrorContext('folder')
      setModalError(reason instanceof Error ? reason.message : String(reason))
      setFlowOpen(false)
      setErrorOpen(true)
    })

  const openDirectoryFlow = useCallback((): void => {
    onClose()
    setErrorOpen(false)
    setModalError(null)
    setFlowOpen(true)
  }, [onClose])

  // A menu exists to disambiguate between targets. With no workspaces listed
  // and the add action the only entry left, the anchor gesture IS that action:
  // a one-row popover would cost a click and offer nothing to choose between.
  // The owner's open request is consumed the same way selecting the entry
  // would consume it (close the popover, raise the flow). An empty list is
  // only final once the baseline lands — until then the menu stays up with its
  // loading status instead of jumping into a flow the arriving list would have
  // made unnecessary; the add-only surface lists nothing and never waits.
  const listSettled = addOnly || workspaceSnapshot.phase === 'ready'
  const actionableEntries = listSettled ? addEntries : []
  // Only the add-workspace gesture consumes the anchor's open request into a
  // flow directly. A sole create-federation entry still shows its one-row
  // menu: the panel is this package's own modal, and the existing
  // single-entry shortcut predates federations (its behavior stays untouched).
  const addIsTheOnlyEntry = !pinAdd && actionableEntries.length === 1
    && actionableEntries.every(entry => entry.id === ADD_WORKSPACE)
  // `flowBusy` gates this exactly as it disables the equivalent menu entry: a
  // pick still being adopted owns the surface until it settles.
  useEffect(() => {
    if (open && addIsTheOnlyEntry && !flowBusy) openDirectoryFlow()
  }, [open, addIsTheOnlyEntry, flowBusy, openDirectoryFlow])

  /** Owner side of the flow conversation: adopt keeps the flow open (busy) until the Host answers. */
  const flowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy: pickingFolder,
    onPicked: (path) => {
      setPickingFolder(true)
      void adoptDirectory(path).finally(() => { setPickingFolder(false) })
    },
    onCancel: () => { setFlowOpen(false) },
    onError: (message) => {
      setErrorContext('folder')
      setFlowOpen(false)
      setModalError(message)
      setErrorOpen(true)
    },
  }

  /**
   * Claim a federation session; failures reuse the shared error dialog under
   * the federation-specific heading. Success opens the session from within
   * the injected callback, leaving the menu free to close immediately.
   */
  const claimFederatedSession = (federationId: FederationId): void => {
    onClose()
    startFederatedSession(federationId).catch((reason: unknown) => {
      setErrorContext('federation')
      setModalError(reason instanceof Error ? reason.message : String(reason))
      setErrorOpen(true)
    })
  }

  const handleSelect = (id: string): void => {
    if (id === ADD_WORKSPACE) {
      openDirectoryFlow()
      return
    }
    if (id === ADD_FEDERATION) {
      onClose()
      setCreatePanelOpen(true)
      return
    }
    if (id.startsWith(FEDERATION_PREFIX)) {
      claimFederatedSession(id.slice(FEDERATION_PREFIX.length) as FederationId)
      return
    }
    onPick(id as WorkspaceId)
  }

  return (
    <>
      <Menu
        open={open && !addIsTheOnlyEntry && !menuIsEmpty}
        anchor={null}
        items={items}
        {...pinAdd ? { footer: addEntries } : {}}
        selectedId={selectedId}
        onSelect={handleSelect}
        onClose={onClose}
        side={side}
        portal
        getAnchorRect={getAnchorRect}
      />
      {open && !addIsTheOnlyEntry && !menuIsEmpty && workspaceSnapshot.phase === 'pending' && <div className={cssFlow.menuStatus} role="status">{t('picker.loading')}</div>}
      {renderDirectoryFlow(flowOwner)}
      <Modal
        open={errorOpen}
        onClose={closeModal}
        closeLabel={t('close')}
        title={t(errorContext === 'federation' ? 'federation.sessionError.title' : 'folderError.title')}
        footer={(
          <>
            <Button variant="outline" className={cssFlow.modalAction} onClick={closeModal}>{t('cancel')}</Button>
            {/* Retrying needs an occupant to serve the flow; without one the
              * button would open a flow nobody can answer or cancel. */}
            <Button variant="primary" className={cssFlow.modalAction} disabled={!flowAvailable} onClick={openDirectoryFlow}>{t('folderError.retry')}</Button>
          </>
        )}
      >
        <div className={cssFlow.modalError} role="alert">{modalError}</div>
      </Modal>
      {createPanelOpen && (
        <CreateFederationPanel
          createFederation={createFederation}
          workspaces={workspaces}
          t={t}
          onClose={() => { setCreatePanelOpen(false) }}
        />
      )}
    </>
  )
}

/**
 * The conversation empty-state registration: adapts the owner share to the
 * core flow (all state and semantics live in the flow / the owner).
 * @param props - empty-state slot props (owner share + injected creation callback).
 * @returns the flow element.
 */
export function WorkspacePicker({
  open,
  anchorRef,
  useWorkspaces,
  selectedId,
  onPick,
  onClose,
  createWorkspace,
  createFederation,
  startFederatedSession,
  useDirectoryFlow,
  renderSlot,
  t,
}: WorkspacePickerProps) {
  return (
    <WorkspacePickFlow
      t={t}
      open={open}
      anchorRef={anchorRef}
      useWorkspaces={useWorkspaces}
      createWorkspace={createWorkspace}
      createFederation={createFederation}
      startFederatedSession={startFederatedSession}
      useDirectoryFlow={useDirectoryFlow}
      renderDirectoryFlow={owner => renderSlot('conversation.hero.workspace.directoryFlow', owner)}
      selectedId={selectedId}
      onPick={onPick}
      onClose={onClose}
    />
  )
}
