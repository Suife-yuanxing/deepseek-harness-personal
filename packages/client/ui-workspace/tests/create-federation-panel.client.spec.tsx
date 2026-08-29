// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FederationView, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from '../src/client/contract/slots.ts'
import { CreateFederationPanel } from '../src/client/CreateFederationPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkspacePickerProps['t'] = makeTranslate(zh, commonZh)

const wid = (id: string) => id as WorkspaceId
function workspace(id: string, title = id): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function created(): FederationView {
  return {
    federationId: 'f-new' as never, title: 'a + b', memberPaths: ['/projects/alpha', '/projects/beta'],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

interface MountOptions {
  workspaces?: readonly WorkspaceView[]
  flowAvailable?: boolean
  createFederation?: (input: { title?: string; memberPaths: string[] }) => Promise<FederationView>
}

function mount({ workspaces = [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')], flowAvailable = false, createFederation }: MountOptions = {}) {
  const carrier = createFederation ?? vi.fn(async () => created())
  const onClose = vi.fn()
  // Flow-seam stub: no real occupant renders, but the owner conversation is
  // captured on every render so tests drive the pick lifecycle directly
  // (onPicked / onCancel / onError) exactly as an occupant would report it.
  const ownerHolder: { current: DirectoryFlowOwnerProps | null } = { current: null }
  const renderDirectoryFlow = vi.fn((flowOwner: DirectoryFlowOwnerProps) => {
    ownerHolder.current = flowOwner
    return null
  })
  const view = render(
    <CreateFederationPanel
      createFederation={carrier}
      workspaces={workspaces}
      flowAvailable={flowAvailable}
      renderDirectoryFlow={renderDirectoryFlow}
      t={t}
      onClose={onClose}
    />,
  )
  return {
    carrier, onClose,
    flowOwner(): DirectoryFlowOwnerProps {
      if (ownerHolder.current === null) throw new Error('directory flow was never rendered')
      return ownerHolder.current
    },
    rerender(nextWorkspaces: readonly WorkspaceView[]): void {
      view.rerender(
        <CreateFederationPanel
          createFederation={carrier}
          workspaces={nextWorkspaces}
          flowAvailable={flowAvailable}
          renderDirectoryFlow={renderDirectoryFlow}
          t={t}
          onClose={onClose}
        />,
      )
    },
  }
}

describe('CreateFederationPanel', () => {
  it('keeps confirm disabled below two members with its hint visible', () => {
    mount()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建' }).disabled).toBe(true)
    expect(screen.getByText('至少选择两个文件夹')).toBeTruthy()
    // One member is still not enough.
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建' }).disabled).toBe(true)
    expect(screen.getByText('至少选择两个文件夹')).toBeTruthy()
  })

  it('fixes the member order by check order and promotes a later check to primary in place', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
    // Alpha checked first is the default primary; its promote button is inert.
    const alphaRow = screen.getByRole('checkbox', { name: /Alpha/ }).closest('div')!
    expect((alphaRow.querySelector('button:not([role])') as HTMLButtonElement)?.disabled).toBe(true)
    // Promoting Beta moves it to first with Alpha keeping its position after.
    const betaRow = screen.getByRole('checkbox', { name: /Beta/ }).closest('div')!
    fireEvent.click(betaRow.querySelector('button:not([role])')!)
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    // The default title follows the new member order (untouched field).
    await waitFor(() => {
      expect(b.carrier).toHaveBeenCalledWith({ title: 'beta + alpha', memberPaths: ['/projects/beta', '/projects/alpha'] })
    })
    expect(b.onClose).toHaveBeenCalled()
  })

  it('recomputes the default title on membership changes until the user types', async () => {
    const b = mount({
      workspaces: [workspace('gamma', 'Gamma'), workspace('delta', 'Delta')],
      createFederation: vi.fn(async () => created()),
    })
    const input = screen.getByLabelText('联合工作区名称') as HTMLInputElement
    expect(input.value).toBe('')
    fireEvent.click(screen.getByRole('checkbox', { name: /Gamma/ }))
    expect(input.value).toBe('gamma')
    fireEvent.click(screen.getByRole('checkbox', { name: /Delta/ }))
    expect(input.value).toBe('gamma + delta')
    // A user draft stops following the recomputation.
    fireEvent.change(input, { target: { value: 'my pair' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(b.carrier).toHaveBeenCalledWith({ title: 'my pair', memberPaths: ['/projects/gamma', '/projects/delta'] })
    })
  })

  it('shows business failures inline and keeps the panel open for retry', async () => {
    const b = mount({
      createFederation: vi.fn(async () => { throw new Error("federation name 'held' is already in use") }),
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe("federation name 'held' is already in use")
    })
    // The dialog stays up; closing happens only through the footer or Escape.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(b.onClose).not.toHaveBeenCalled()
  })

  it('renders the empty state when no member source exists at all', () => {
    mount({ workspaces: [] })
    expect(screen.getByText('暂无会话')).toBeTruthy()
  })

  it('with a flow occupant, an empty registry is no dead end for free folders', () => {
    mount({ workspaces: [], flowAvailable: true })
    expect(screen.queryByText('暂无会话')).toBeNull()
    expect(screen.getByText('添加文件夹…')).toBeTruthy()
  })

  it('toggles a checked member back off and drops ids whose workspace vanished mid-panel', () => {
    mount({
      // A never-settling call keeps the panel in-flight through both submits,
      // but only one carrier invocation happens: the guard returns early.
      createFederation: vi.fn(() => new Promise<FederationView>(() => {})),
    })
    const alphaRow = screen.getByRole('checkbox', { name: /Alpha/ })
    // Check then uncheck: the second toggle removes the id from the order.
    fireEvent.click(alphaRow)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建' }).disabled).toBe(true)
    // Restore Alpha, add Beta, submit twice while in flight.
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops a stale member id whose workspace vanished from a refreshed list', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    // The refresh removes Alpha (deleted elsewhere): its selected id stays but
    // projection drops it, so the default title cannot fabricate a basename.
    act(() => { b.rerender([workspace('beta', 'Beta')]) })
    const input = screen.getByLabelText('联合工作区名称') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('locks a presence-probe-missing workspace out of the member set with the reason shown', () => {
    mount({
      workspaces: [{ ...workspace('gone', 'Gone'), missing: true }, workspace('beta', 'Beta')],
    })
    // The row says why it is locked and refuses selection; the healthy row
    // still toggles.
    expect(screen.getByText('目录已失效：路径不存在或不可访问')).toBeTruthy()
    const gone = screen.getByRole('checkbox', { name: /Gone/ }) as HTMLButtonElement
    expect(gone.disabled).toBe(true)
    fireEvent.click(gone)
    expect(gone.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
    expect(screen.getByRole('checkbox', { name: /Beta/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('submits without a title key when the user clears the draft entirely', async () => {
    const b = mount()
    const input = screen.getByLabelText('联合工作区名称')
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
    // Touch then clear: an empty draft submits with no title (Host default).
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(b.carrier).toHaveBeenCalledWith({ memberPaths: ['/projects/alpha', '/projects/beta'] })
    })
  })

  it('keeps the panel open for retry after a failed create', async () => {
    const b = mount({
      createFederation: vi.fn(async () => { throw new Error("federation name 'held' is already in use") }),
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe("federation name 'held' is already in use")
    })
    // The dialog stays up; closing happens only through the footer or Escape.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(b.onClose).not.toHaveBeenCalled()
  })

  describe('free folder members', () => {
    it('hides the add-folder row without a flow occupant and opens the flow with one', () => {
      mount()
      expect(screen.queryByText('添加文件夹…')).toBeNull()
      // With an occupant the row exists and raising it hands the owner an
      // open flow; cancelling withdraws the request. Outcome callbacks fire
      // outside React's event system, so each one rides act() like the
      // occupant's callers would in a composed host.
      const b = mount({ flowAvailable: true })
      fireEvent.click(screen.getByText('添加文件夹…'))
      expect(b.flowOwner().open).toBe(true)
      act(() => { b.flowOwner().onCancel() })
      expect(b.flowOwner().open).toBe(false)
    })

    it('appends a picked folder as a checked member that cannot promote', () => {
      const b = mount({ flowAvailable: true })
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onPicked('D:\\free\\extra') })
      const folderRow = screen.getByRole('checkbox', { name: /extra/ })
      expect(folderRow.getAttribute('aria-checked')).toBe('true')
      // The default title follows the folder basename (untouched field).
      const input = screen.getByLabelText('联合工作区名称') as HTMLInputElement
      expect(input.value).toBe('extra')
      // The folder's promote button is disabled with its reason on the tooltip.
      const row = folderRow.closest('div')!
      const promote = row.querySelector('button:not([role])') as HTMLButtonElement
      expect(promote.disabled).toBe(true)
      expect(promote.title).toBe('自由选择的文件夹不能设为主目录：联合会话附着在主目录对应的已注册工作区上')
    })

    it('refuses an exact duplicate path inline instead of adding a second row', () => {
      const b = mount({ flowAvailable: true })
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onPicked('D:\\free\\extra') })
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onPicked('D:\\free\\extra') })
      expect(screen.getByRole('alert').textContent).toBe('该文件夹已在成员列表中')
      // One folder row only; the flow withdrew after each pick.
      expect(b.flowOwner().open).toBe(false)
      expect(screen.getAllByRole('checkbox', { name: /extra/ }).length).toBe(1)
    })

    it('lets a workspace promote ahead of a folder and submits the mixed order', async () => {
      const b = mount({ flowAvailable: true })
      // Folder lands first (state index 0), then Alpha is checked after it.
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onPicked('D:\\free\\extra') })
      fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
      // The folder cannot take the primary seat; Alpha can move ahead of it.
      fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }).closest('div')!.querySelector('button:not([role])')!)
      const input = screen.getByLabelText('联合工作区名称') as HTMLInputElement
      expect(input.value).toBe('alpha + extra')
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
      await waitFor(() => {
        expect(b.carrier).toHaveBeenCalledWith({ title: 'alpha + extra', memberPaths: ['/projects/alpha', 'D:\\free\\extra'] })
      })
    })

    it('removes a folder member through its toggle-off gesture', () => {
      const b = mount({ flowAvailable: true })
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onPicked('D:\\free\\extra') })
      fireEvent.click(screen.getByRole('checkbox', { name: /extra/ }))
      expect(screen.queryByRole('checkbox', { name: /extra/ })).toBeNull()
      const input = screen.getByLabelText('联合工作区名称') as HTMLInputElement
      expect(input.value).toBe('')
    })

    it('builds a folders-only federation when no workspace is checked', async () => {
      const b = mount({ flowAvailable: true, workspaces: [] })
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onPicked('D:\\free\\one') })
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onPicked('D:\\free\\two') })
      fireEvent.click(screen.getByRole('button', { name: '创建' }))
      await waitFor(() => {
        expect(b.carrier).toHaveBeenCalledWith({ title: 'one + two', memberPaths: ['D:\\free\\one', 'D:\\free\\two'] })
      })
      expect(b.onClose).toHaveBeenCalled()
    })

    it('surfaces a flow failure inline and leaves the panel intact', () => {
      const b = mount({ flowAvailable: true })
      fireEvent.click(screen.getByText('添加文件夹…'))
      act(() => { b.flowOwner().onError('chooser unavailable') })
      expect(screen.getByRole('alert').textContent).toBe('chooser unavailable')
      expect(b.flowOwner().open).toBe(false)
      expect(b.onClose).not.toHaveBeenCalled()
    })
  })
})
