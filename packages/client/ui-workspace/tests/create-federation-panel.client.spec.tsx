// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  FederationView, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspacePickerProps } from '../src/client/contract/slots.ts'
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
  createFederation?: (input: { title?: string; memberPaths: string[] }) => Promise<FederationView>
}

function mount({ workspaces = [workspace('alpha', 'Alpha'), workspace('beta', 'Beta')], createFederation }: MountOptions = {}) {
  const carrier = createFederation ?? vi.fn(async () => created())
  const onClose = vi.fn()
  render(
    <CreateFederationPanel
      createFederation={carrier}
      workspaces={workspaces}
      t={t}
      onClose={onClose}
    />,
  )
  return { carrier, onClose }
}

describe('CreateFederationPanel', () => {
  it('keeps confirm disabled below two members with its hint visible', () => {
    mount()
    expect(screen.getByRole('button', { name: '创建' }).disabled).toBe(true)
    expect(screen.getByText('至少选择两个文件夹')).toBeTruthy()
    // One member is still not enough.
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }))
    expect(screen.getByRole('button', { name: '创建' }).disabled).toBe(true)
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

  it('renders the empty state when no workspace exists to become a member', () => {
    mount({ workspaces: [] })
    expect(screen.getByText('暂无会话')).toBeTruthy()
  })
})
