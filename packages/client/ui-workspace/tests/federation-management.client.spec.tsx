// @vitest-environment jsdom
/**
 * The browser's federation management block: durable federation rows above
 * the session tree with rename/delete through the browser-owned dialogs.
 * Coverage split: rows hide while the list holds no federations (zero
 * visual diff for federation-free installs) and render regardless of the
 * gray switch (management outlives creation: deleting after switch-off is
 * exactly when it is needed); the rename flow reaches the injected carrier
 * with the edge-trimmed draft, the duplicate rule reads the federation title
 * set, and the delete dialog states the non-destructive semantics before
 * committing. The carriers' wire behavior stays with the runtime package;
 * the pick-flow menu rows stay with workspace-picker.spec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { FederationId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

const FED_A = 'fed-a' as FederationId
const FED_B = 'fed-b' as FederationId

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Runtime with the locale face installed (the browser entry declares `locale:` — zh default backs the t seat). */
async function createRuntime(): Promise<SlotTestRuntime> {
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  return runtime
}

/** Test-owned sidebar shell role: declares and renders the browsing region. */
type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function SidebarFrame({ renderSlot }: FrameProps) {
  return <>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</>
}

/** Seed one member workspace so the tree has its usual baseline beside the block. */
function memberWorkspace(id: string, title: string, path: string): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId, title, path, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Seed two federations (the duplicate rule needs a second title to collide with). */
async function seedFederations(runtime: SlotTestRuntime): Promise<void> {
  await runtime.workspaces.update((draft) => {
    draft.items = [
      memberWorkspace('w1', 'alpha', '/w/alpha'),
      memberWorkspace('w2', 'beta', '/w/beta'),
    ] as never
    draft.federations = [
      {
        federationId: FED_A, title: 'alpha + beta',
        memberPaths: ['/w/alpha', '/w/beta'],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        federationId: FED_B, title: 'docs + site',
        memberPaths: ['/w/docs', '/w/site'],
        createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      },
      // The list's presence probe flagged one member: the row shows the marker.
      {
        federationId: 'fed-c' as FederationId, title: 'stale pair',
        memberPaths: ['/w/stale', '/w/kept'],
        createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z',
        missingMembers: ['/w/stale'],
      },
    ] as never
  })
}

describe('federation management block', () => {
  it('hides entirely while the list holds no federations', async () => {
    const runtime = await createRuntime()
    await runtime.workspaces.update((draft) => {
      draft.items = [memberWorkspace('w1', 'alpha', '/w/alpha')] as never
    })
    await runtime.root.declare(
      { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    await view.findByText('alpha')
    expect(view.queryByText('联合工作区')).toBeNull()
    expect(view.queryByLabelText('联合工作区“alpha + beta”的操作')).toBeNull()
    await runtime.dispose()
  })

  it('renders rows with badge and member tooltip regardless of the gray switch, and renames through the dialog', async () => {
    const runtime = await createRuntime()
    await seedFederations(runtime)
    // Management outlives creation: switch-off must keep the rows so the
    // leftover compositions stay deletable.
    await runtime.workspaces.update((draft) => { draft.federatedWorkspacesEnabled = false })
    await runtime.root.declare(
      { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    await view.findByText('联合工作区')
    // The tooltip rides the title span (primary root first); the badge sits
    // beside it inside the same row (both seeded rows show ×2 — scope to one).
    const titleSpan = view.getByText('alpha + beta')
    expect(titleSpan.getAttribute('title')).toBe('主 alpha\nbeta')
    expect(within(titleSpan.closest('div')!).getByText('×2')).toBeTruthy()

    fireEvent.click(view.getByLabelText('联合工作区“alpha + beta”的操作'))
    fireEvent.click(view.getByRole('menuitem', { name: '重命名', hidden: true }))
    const input = await view.findByLabelText('联合工作区名称') as HTMLInputElement
    expect(input.value).toBe('alpha + beta')
    fireEvent.change(input, { target: { value: '  前端 + 后端  ' } })
    fireEvent.click(view.getByRole('button', { name: '重命名' }))

    await waitFor(() => { expect(view.queryByLabelText('联合工作区名称')).toBeNull() })
    const rename = runtime.workspaces.calls.filter(call => call.method === 'renameFederation')
    expect(rename).toEqual([{ method: 'renameFederation', args: [FED_A, '前端 + 后端'] }])
    // The row re-labels from the list state after the refresh convergence.
    await runtime.workspaces.update((draft) => {
      draft.federations = draft.federations.map(federation => federation.federationId === FED_A
        ? { ...federation, title: '前端 + 后端' }
        : federation)
    })
    await view.findByText('前端 + 后端')
    await runtime.dispose()
  })

  it('blocks a duplicate title inline and surfaces a rejected rename', async () => {
    const runtime = await createRuntime()
    const renameFederation = vi.fn(async () => {
      throw new Error('federation rename failed: federation-name-conflict: held')
    })
    runtime.workspaces.stub('renameFederation', () => renameFederation())
    await seedFederations(runtime)
    await runtime.root.declare(
      { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    fireEvent.click(await view.findByLabelText('联合工作区“alpha + beta”的操作'))
    fireEvent.click(view.getByRole('menuitem', { name: '重命名', hidden: true }))
    const input = await view.findByLabelText('联合工作区名称')
    fireEvent.change(input, { target: { value: 'docs + site' } })
    // The duplicate rule reads the federation title set: confirm stays disabled.
    expect(view.getByText('已存在名为“docs + site”的联合工作区。')).toBeTruthy()
    expect((view.getByRole('button', { name: '重命名' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: '独占名' } })
    fireEvent.click(view.getByRole('button', { name: '重命名' }))
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('federation-name-conflict')
    expect(view.getByLabelText('联合工作区名称')).toBeTruthy()
    await runtime.dispose()
  })

  it('marks a row whose list probe flagged missing members, tooltip carrying the per-member marker', async () => {
    const runtime = await createRuntime()
    await seedFederations(runtime)
    await runtime.root.declare(
      { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    const staleTitle = await view.findByText('stale pair')
    expect(staleTitle.getAttribute('title')).toBe('主 stale（已失效）\nkept')
    expect(within(staleTitle.closest('div')!).getByText('已失效')).toBeTruthy()
    // Healthy rows carry no marker.
    expect(view.getByText('alpha + beta').getAttribute('title')).toBe('主 alpha\nbeta')
    await runtime.dispose()
  })

  it('deletes through the confirmation dialog stating the non-destructive semantics', async () => {
    const runtime = await createRuntime()
    await seedFederations(runtime)
    await runtime.root.declare(
      { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    fireEvent.click(await view.findByLabelText('联合工作区“alpha + beta”的操作'))
    fireEvent.click(view.getByRole('menuitem', { name: '删除联合工作区', hidden: true }))
    await view.findByText('将把“alpha + beta”从联合工作区列表中移除。文件夹、工作区与会话记录都保留，现有联合会话可继续使用，仅停止从它新建会话。')
    fireEvent.click(view.getByRole('button', { name: '删除联合工作区' }))

    await waitFor(() => { expect(view.queryByText('将把“alpha + beta”从联合工作区列表中移除。文件夹、工作区与会话记录都保留，现有联合会话可继续使用，仅停止从它新建会话。')).toBeNull() })
    expect(runtime.workspaces.calls.filter(call => call.method === 'deleteFederation'))
      .toEqual([{ method: 'deleteFederation', args: [FED_A] }])
    // The row leaves on the baseline convergence, not on the unary answer.
    await runtime.workspaces.update((draft) => {
      draft.federations = draft.federations.filter(federation => federation.federationId !== FED_A)
    })
    await waitFor(() => { expect(view.queryByText('alpha + beta')).toBeNull() })
    expect(view.getByText('docs + site')).toBeTruthy()
    await runtime.dispose()
  })
})
