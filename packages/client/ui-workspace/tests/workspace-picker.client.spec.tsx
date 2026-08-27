// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  FederationView, SessionListState, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from '../src/client/contract/slots.ts'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import cssFed from '../src/client/Federations.module.css'
import { WorkspacePicker } from '../src/client/WorkspacePicker.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is workspace ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: WorkspacePickerProps['t'] = makeTranslate(zh, commonZh)

const wid = (id: string) => id as WorkspaceId
const fid = (id: string) => id as FederationView['federationId']
function workspace(id: string, title = id): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function federation(id: string, title: string, memberPaths: string[]): FederationView {
  return {
    federationId: fid(id), title, memberPaths,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}
const sessions: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
}
const workspaceState = (
  items: readonly WorkspaceView[],
  extra: Partial<WorkspaceListState> = {},
): WorkspaceListState => ({
  items, archivedSessionIds: [], federations: [], federatedWorkspacesEnabled: true,
  state: 'idle', phase: 'ready', error: null, baselinesReady: true,
  recentWorkspaceId: items[0]?.workspaceId,
  ...extra,
})
function anchor(): { current: HTMLElement } {
  const element = document.createElement('button')
  element.getBoundingClientRect = () => ({
    top: 10, left: 20, width: 30, height: 40, right: 50, bottom: 50,
    x: 20, y: 10, toJSON: () => ({}),
  })
  return { current: element }
}

/**
 * Probe occupant of the directory-flow hole: records the latest owner
 * conversation so tests drive onPicked/onCancel/onError like a composed flow
 * package would, and renders a marker element while the flow is open.
 */
function flowProbe() {
  const probe: { owner: DirectoryFlowOwnerProps | undefined } = { owner: undefined }
  const renderSlot = ((_name: string, owner: DirectoryFlowOwnerProps) => {
    probe.owner = owner
    return owner.open ? <div data-testid="directory-flow" data-busy={owner.busy} /> : null
  }) as never
  return { probe, renderSlot }
}

/** Manual occupancy source bound like the renderer would: flip() drives the hook like a real registration change. */
function occupancySource(initial = true) {
  let occupied = initial
  const listeners = new Set<() => void>()
  const useDirectoryFlow = bindSnapshotSelector({
    getSnapshot: () => occupied,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
  return {
    useDirectoryFlow,
    flip: (next: boolean) => {
      occupied = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function mount(
  items: readonly WorkspaceView[] = [workspace('alpha', 'Alpha')],
  createWorkspace = vi.fn(),
  occupancy = occupancySource(),
  listExtra: Partial<WorkspaceListState> = {},
) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const createFederation = vi.fn(async () => federation('f-new', 'new', []))
  const startFederatedSession = vi.fn(async () => {})
  const anchorRef = anchor()
  const { probe, renderSlot } = flowProbe()
  const renderPicker = (nextItems: readonly WorkspaceView[], nextExtra?: Partial<WorkspaceListState>) => (
    <WorkspacePicker
      open
      anchorRef={anchorRef}
      useSessions={hook(sessions)}
      useWorkspaces={hook(workspaceState(nextItems, nextExtra ?? listExtra))}
      onPick={onPick}
      onClose={onClose}
      createWorkspace={createWorkspace}
      createFederation={createFederation}
      startFederatedSession={startFederatedSession}
      useDirectoryFlow={occupancy.useDirectoryFlow}
      renderSlot={renderSlot}
      t={t}
    />
  )
  const view = render(
    renderPicker(items),
  )
  return {
    view, onPick, onClose, createWorkspace, probe, occupancy,
    createFederation, startFederatedSession,
    rerenderItems(nextItems: readonly WorkspaceView[], nextExtra?: Partial<WorkspaceListState>): void {
      view.rerender(renderPicker(nextItems, nextExtra))
    },
  }
}

function chooseAdd(): void {
  fireEvent.click(screen.getByRole('menuitem', { name: '添加工作区…' }))
}

describe('WorkspacePicker', () => {
  it('lists same-title Workspaces separately and forwards the selected id', () => {
    const b = mount([workspace('alpha', 'Shared'), workspace('beta', 'Shared')])
    const entries = screen.getAllByRole('menuitem', { name: 'Shared' })
    expect(entries).toHaveLength(2)
    fireEvent.click(entries[1]!)
    expect(b.onPick).toHaveBeenCalledWith(wid('beta'))
  })

  it('opens the composed directory flow, adopts its picked path, and selects the returned Workspace', async () => {
    const created = { ...workspace('adopted'), path: '/tmp/project', title: 'project' }
    const createWorkspace = vi.fn(async () => created)
    const b = mount([workspace('alpha', 'Alpha')], createWorkspace)
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    chooseAdd()
    expect(b.onClose).toHaveBeenCalled()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    await act(async () => { b.probe.owner!.onPicked('/tmp/project') })
    expect(createWorkspace).toHaveBeenCalledWith({ path: '/tmp/project' })
    await waitFor(() => { expect(b.onPick).toHaveBeenCalledWith(created.workspaceId) })
    // Successful adoption withdraws the flow request.
    expect(screen.queryByTestId('directory-flow')).toBeNull()
  })

  it('raises the flow straight from the anchor gesture when adding is the only entry', () => {
    // Nothing to list and one action left: a one-row menu would offer no
    // choice, so the owner's open request lands in the flow itself.
    // (Federation affordances off: this guard predates them — with both
    // actions present the gesture shows the two-row menu instead.)
    const b = mount([], vi.fn(), occupancySource(), { federatedWorkspacesEnabled: false })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
    expect(b.onClose).toHaveBeenCalled()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
  })

  it('treats flow cancellation as a silent no-op', () => {
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    act(() => { b.probe.owner!.onCancel() })
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
    expect(b.onPick).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports a non-Error adoption failure in the folder-error surface', async () => {
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(async () => { throw 'permission denied' }))
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toBe('permission denied')
    expect(b.probe.owner!.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '重新选择' }))
    expect(b.probe.owner!.open).toBe(true)
    expect(b.onPick).not.toHaveBeenCalled()
  })

  it('disables every menu action from flow open through adoption, and reports busy to the flow', async () => {
    let resolve!: (workspace: WorkspaceView) => void
    const pending = new Promise<WorkspaceView>((settle) => { resolve = settle })
    const created = workspace('adopted')
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(() => pending))
    chooseAdd()
    // The flow is open but nothing is picked yet: a chooser pending on the
    // host display must already block concurrent workspace actions.
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: '添加工作区…' }).disabled).toBe(true)
    act(() => { b.probe.owner!.onPicked('/tmp/project') })
    expect(b.probe.owner!.busy).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: '添加工作区…' }).disabled).toBe(true)
    await act(async () => { resolve(created); await pending })
    expect(b.probe.owner!.busy).toBe(false)
  })

  it('shows the flow-reported failure in the folder-error surface', () => {
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    act(() => { b.probe.owner!.onError('no chooser installed') })
    expect(screen.getByRole('alert').textContent).toBe('no chooser installed')
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
  })

  it('closes the folder-error surface when the user cancels', () => {
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    act(() => { b.probe.owner!.onError('no chooser installed') })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits to show its menu until an optional anchor is available', () => {
    const { renderSlot } = flowProbe()
    render(
      <WorkspacePicker
        open useSessions={hook(sessions)} useWorkspaces={hook(workspaceState([workspace('alpha', 'Alpha')]))}
        onPick={vi.fn()} onClose={vi.fn()} createWorkspace={vi.fn()}
        createFederation={vi.fn(async () => federation('f-new', 'new', []))}
        startFederatedSession={vi.fn(async () => {})}
        useDirectoryFlow={occupancySource().useDirectoryFlow} renderSlot={renderSlot} t={t}
      />,
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the menu up while the list baseline is still in flight', () => {
    const state: WorkspaceListState = {
      ...workspaceState([], { phase: 'pending', state: 'loading', baselinesReady: false }),
    }
    const { renderSlot } = flowProbe()
    render(
      <WorkspacePicker
        open anchorRef={anchor()} useSessions={hook(sessions)} useWorkspaces={hook(state)}
        onPick={vi.fn()} onClose={vi.fn()} createWorkspace={vi.fn()}
        createFederation={vi.fn(async () => federation('f-new', 'new', []))}
        startFederatedSession={vi.fn(async () => {})}
        useDirectoryFlow={occupancySource().useDirectoryFlow} renderSlot={renderSlot} t={t}
      />,
    )
    // An empty list is not final yet: jumping into the directory flow here
    // would pre-empt the workspaces about to arrive.
    expect(screen.getByRole('status').textContent).toBe('正在加载工作区…')
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(screen.getByRole('menuitem', { name: '添加工作区…' })).toBeTruthy()
  })

  it('shows no popover at all when nothing is listed and nothing can be added', () => {
    // A composition mounting this package without any directory-picker: the
    // hero anchor has neither a Workspace to pick nor a way to add one, so it
    // must not claim a choice with an empty menu. (Gray switch off keeps the
    // federation action hidden too.)
    const b = mount([], vi.fn(), occupancySource(false), { federatedWorkspacesEnabled: false })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
  })

  it('shows the create-federation row alone as a real choice when the picker composition lacks a directory flow', () => {
    // Gray switch on and a picker-less composition: the federation action is
    // a genuinely servable choice, so a one-row menu appears rather than an
    // empty surface claiming nothing exists to do.
    mount([], vi.fn(), occupancySource(false))
    expect(screen.getByRole('menuitem', { name: '新建联合工作区…' })).toBeTruthy()
  })

  it('holds the anchor gesture while an adoption is still settling', async () => {
    // The auto-open path obeys the same busy rule as the disabled menu entry:
    // an occupant that re-registers mid-adoption must not raise a second flow.
    let resolve!: (workspace: WorkspaceView) => void
    const pending = new Promise<WorkspaceView>((settle) => { resolve = settle })
    const created = workspace('adopted')
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(() => pending))
    chooseAdd()
    act(() => { b.probe.owner!.onPicked('/tmp/project') })
    expect(b.probe.owner!.busy).toBe(true)
    // The list empties under the still-settling adoption (the workspace was
    // deleted elsewhere), which would otherwise make add the only entry.
    act(() => { b.rerenderItems([]) })
    expect(b.createWorkspace).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(created); await pending })
    expect(b.probe.owner!.busy).toBe(false)
  })

  it('hides the add entry while the directory-flow hole is empty', () => {
    mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(false))
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
  })

  it('shows the add entry when a flow package activates after the first paint', () => {
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(false))
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
    // Registration changes flow through the subscription, no re-render needed.
    act(() => { b.occupancy.flip(true) })
    expect(screen.getByRole('menuitem', { name: '添加工作区…' })).toBeTruthy()
  })

  it('keeps Choose again inert while the flow occupant is gone, and snaps back a flow opened over an empty hole', async () => {
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(async () => { throw new Error('adoption failed') }))
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy() })
    // The occupant unloads while the error dialog is up: retrying would open
    // a flow nobody can serve or cancel, so the button goes inert.
    act(() => { b.occupancy.flip(false) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新选择' }).disabled).toBe(true)
    // Cancel stays the way out, and the menu actions are usable again.
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(false)
  })

  it('withdraws an open flow when its occupant unloads, re-enabling the menu actions', () => {
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    // The flow plugin unloads mid-interaction (HMR): nobody is left to
    // cancel, so the owner withdraws and the actions come back.
    act(() => { b.occupancy.flip(false) })
    expect(b.probe.owner!.open).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(false)
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
  })

  describe('federation entries', () => {
    const pair = federation('f1', 'front + back', ['/projects/alpha', '/projects/back'])

    it('lists federations after regular workspaces with member count badges and a tooltip', () => {
      mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(), { federations: [pair] })
      // Document order: scroll-region rows (workspace first, federation
      // after), then the pinned add actions.
      expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
        'Alpha',
        'front + back×2',
        '添加工作区…',
        '新建联合工作区…',
      ])
      const fedRow = screen.getByRole('menuitem', { name: /front \+ back/ })
      expect(fedRow.querySelector('[title]')?.getAttribute('title')).toBe('主 alpha\nback')
    })

    it('claims a picked federation through the carrier and closes the menu', async () => {
      const b = mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(), { federations: [pair] })
      fireEvent.click(screen.getByRole('menuitem', { name: /front \+ back/ }))
      expect(b.startFederatedSession).toHaveBeenCalledWith(pair.federationId)
      expect(b.onClose).toHaveBeenCalled()
      expect(b.onPick).not.toHaveBeenCalled()
    })

    it('raises the create panel from the action and creates through the carrier', async () => {
      const b = mount(
        [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')],
        vi.fn(),
        occupancySource(),
      )
      fireEvent.click(screen.getByRole('menuitem', { name: '新建联合工作区…' }))
      expect(screen.getByRole('dialog', { name: '新建联合工作区' })).toBeTruthy()
      // <2 members keeps confirm disabled with its hint.
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建' }).disabled).toBe(true)
      expect(screen.getByText('至少选择两个文件夹')).toBeTruthy()
      // Two checks make the default title from basenames; create carries them in check order.
      fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
      fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建' }).disabled).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
      await waitFor(() => {
        expect(b.createFederation).toHaveBeenCalledWith({ title: 'alpha + beta', memberPaths: ['/projects/alpha', '/projects/beta'] })
      })
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })
    })

    it('hides every federation affordance while the gray switch is off, keeping plain rows intact', () => {
      const b = mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(), {
        federatedWorkspacesEnabled: false,
        federations: [pair],
      })
      expect(screen.queryByRole('menuitem', { name: /front \+ back/ })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: '新建联合工作区…' })).toBeNull()
      // Regular workspace row unaffected.
      expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeTruthy()
      expect(b.createFederation).not.toHaveBeenCalled()
    })

    it('leaves no federation DOM at all for an ordinary deployment', () => {
      mount([workspace('alpha', 'Alpha')])
      expect(document.querySelector(`.${cssFed.fedBadge}`)).toBeNull()
      expect(document.querySelectorAll(`.${cssFed.fedLabel}`).length).toBe(0)
    })

    it('reports a failed session claim under the federation error heading', async () => {
      const b = mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(), {
        federations: [pair],
      })
      b.startFederatedSession.mockRejectedValueOnce(new Error('gray switch is closed'))
      fireEvent.click(screen.getByRole('menuitem', { name: /front \+ back/ }))
      await waitFor(() => {
        expect(screen.getByRole('dialog', { name: '无法打开联合会话' })).toBeTruthy()
      })
      expect(screen.getByRole('alert').textContent).toBe('gray switch is closed')
    })
  })
})
