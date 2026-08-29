import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { HostFrame, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`workspace-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

async function nextHostFrame(
  stream: AsyncIterator<RpcRequest<HostFrame>>,
): Promise<RpcRequest<HostFrame>> {
  const next = await stream.next()
  if (next.done === true) throw new Error('Host stream ended before the expected increment')
  return next.value
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Compose the API over real Session, Agent, Storage, Domain, and Workspace services. */
async function harness(
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-workspace-'))),
  picker: DirectoryPickerCapability = { kind: 'native', pick: async () => null },
  extras: {
    openPath?: (path: string, signal: AbortSignal) => Promise<void>
    canOpenPath?: () => boolean
    federatedWorkspacesEnabled?: boolean
  } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  // Structural picker fake: the gateway only reads capability(); a stable
  // object per harness mirrors the seam's stability contract.
  ctx.provide('directoryPicker', { capability: () => picker } as never)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
    ...extras.openPath === undefined ? {} : { openPath: extras.openPath },
    ...extras.canOpenPath === undefined ? {} : { canOpenPath: extras.canOpenPath },
    ...extras.federatedWorkspacesEnabled === undefined
      ? {}
      : { federatedWorkspacesEnabled: extras.federatedWorkspacesEnabled },
  })
  return { api, ctx, storageDomain, root }
}

/** Stage one directory under the harness root for path adoption. */
function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}

describe('host.pickDirectory', () => {
  it('returns a selected path or explicit cancellation from the native capability', async () => {
    const selected = await harness(undefined, { kind: 'native', pick: async () => '/tmp/project' })
    expect((await selected.api.host.pickDirectory(request({}), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { path: '/tmp/project' } })

    const cancelled = await harness(undefined, { kind: 'native', pick: async () => null })
    expect((await cancelled.api.host.pickDirectory(request({}), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { path: null } })
  })

  it('propagates abort into the native capability as a cancelled RPC error', async () => {
    const { api } = await harness(undefined, {
      kind: 'native',
      pick: signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }),
    })
    const abort = new AbortController()
    const pending = api.host.pickDirectory(request({}), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('folds a non-abort native-chooser failure into an internal error', async () => {
    const { api } = await harness(undefined, { kind: 'native', pick: async () => { throw new Error('no chooser installed') } })
    const response = await api.host.pickDirectory(request({}), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('refuses the native RPC under a browse composition', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    const response = await api.host.pickDirectory(request({}), new AbortController().signal)
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'directory-picker-unavailable', details: { capability: 'browse' } },
    })
  })
})

/** Canned browse capability: one listing, one created path, typed failures on demand. */
const BROWSE_STUB: DirectoryPickerCapability = {
  kind: 'browse',
  list: async (path) => {
    if (path === '/denied') throw new DirectoryPickerError('directory-unreadable', '/denied', 'cannot list /denied')
    const target = path ?? '/home/user'
    return {
      path: target,
      home: '/home/user',
      crumbs: [{ name: '/', path: '/', hidden: false }],
      entries: [{ name: 'projects', path: `${target}/projects`, hidden: false }],
      truncated: false,
    }
  },
  createDirectory: async (path, name) => {
    if (name === 'taken') throw new DirectoryPickerError('directory-exists', `${path}/${name}`, 'already exists')
    if (name === 'unwritable') throw new Error('disk detached')
    return `${path}/${name}`
  },
}

describe('host.listDirectory / host.createDirectory', () => {
  it('serves listings and creation through the browse capability, defaulting to home', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    const home = await api.host.listDirectory(request({}), new AbortController().signal)
    expect(home.result).toMatchObject({ ok: true, value: { path: '/home/user', home: '/home/user' } })
    const listed = await api.host.listDirectory(request({ path: '/home/user/projects' }), new AbortController().signal)
    expect(listed.result).toMatchObject({ ok: true, value: { path: '/home/user/projects' } })
    const created = await api.host.createDirectory(request({ path: '/home/user', name: 'fresh' }))
    expect(created.result).toEqual({ ok: true, value: { path: '/home/user/fresh' } })
  })

  it('maps typed picker failures onto the wire error codes and folds unknown throws to internal', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    expect((await api.host.listDirectory(request({ path: '/denied' }), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'directory-unreadable', details: { path: '/denied' } },
    })
    expect((await api.host.createDirectory(request({ path: '/home/user', name: 'taken' }))).result).toMatchObject({
      ok: false, error: { code: 'directory-exists' },
    })
    expect((await api.host.createDirectory(request({ path: '/home/user', name: 'unwritable' }))).result).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
  })

  it('reports an aborted listing as cancelled, like the other signal-following RPCs', async () => {
    const { api } = await harness(undefined, {
      kind: 'browse',
      list: (_path, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('scan aborted')) }, { once: true })
      }),
      createDirectory: async () => '/never',
    })
    const abort = new AbortController()
    const pending = api.host.listDirectory(request({}), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('refuses the browse RPCs under a native composition', async () => {
    const { api } = await harness()
    expect((await api.host.listDirectory(request({}), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'directory-picker-unavailable', details: { capability: 'native' } },
    })
    expect((await api.host.createDirectory(request({ path: '/x', name: 'y' }))).result).toMatchObject({
      ok: false, error: { code: 'directory-picker-unavailable', details: { capability: 'native' } },
    })
  })
})

describe('host.openPath', () => {
  it('describes whether this deployment can reach a user-visible native desktop', async () => {
    const visible = await harness(undefined, undefined, { canOpenPath: () => true })
    const headless = await harness(undefined, undefined, { canOpenPath: () => false })
    expect(expectOk(await visible.api.host.describe(request({}))).canOpenPath).toBe(true)
    expect(expectOk(await headless.api.host.describe(request({}))).canOpenPath).toBe(false)
  })

  it('opens through the injected native boundary', async () => {
    const opened: string[] = []
    const { api } = await harness(undefined, undefined, {
      openPath: async (path) => { opened.push(path) },
    })
    expect((await api.host.openPath(request({ path: '/tmp/a.txt' }), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { opened: true } })
    expect(opened).toEqual(['/tmp/a.txt'])
  })

  it('propagates abort into the native boundary as a cancelled RPC error', async () => {
    const { api } = await harness(undefined, undefined, {
      openPath: (_path, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }),
    })
    const abort = new AbortController()
    const pending = api.host.openPath(request({ path: '/tmp/a.txt' }), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})

describe('workspace.create', () => {
  it('serializes concurrent creates of one path into a single registration', async () => {
    const { api, root } = await harness()
    const target = stageDir(root, 'alpha')
    const responses = await Promise.all([
      api.workspace.create(request({ path: target })),
      api.workspace.create(request({ path: target })),
    ])
    const values = responses.map(response => expectOk(response))
    const created = values.find(value => value.created)
    const resolved = values.find(value => !value.created)

    expect(created).toMatchObject({ workspace: { path: target, title: 'alpha' } })
    expect(resolved?.workspace.workspaceId).toBe(created?.workspace.workspaceId)
    expect(expectOk(await api.workspace.list(request({}))).items).toHaveLength(1)
  })

  it('adopts only existing directories', async () => {
    const { api, root } = await harness()
    const existing = stageDir(root, 'existing')
    const first = expectOk(await api.workspace.create(request({ path: existing })))
    const repeated = expectOk(await api.workspace.create(request({ path: existing })))
    expect(first).toMatchObject({ created: true, workspace: { path: existing, title: 'existing' } })
    expect(repeated).toMatchObject({ created: false, workspace: { workspaceId: first.workspace.workspaceId } })

    expectOk(await api.workspace.rename(request({
      workspaceId: first.workspace.workspaceId,
      title: 'renamed-existing',
    })))
    const reopened = expectOk(await api.workspace.create(request({ path: existing })))
    expect(reopened.workspace.title).toBe('renamed-existing')

    const missing = join(root, 'missing')
    const missingResult = await api.workspace.create(request({ path: missing }))
    expect(missingResult.result).toMatchObject({ ok: false, error: { code: 'workspace-invalid-path' } })
    expect(existsSync(missing)).toBe(false)
  })

  it('adopts different paths that derive the same Workspace title', async () => {
    const { api, root } = await harness()
    const first = join(root, 'one', 'project')
    const second = join(root, 'two', 'project')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    const firstResult = expectOk(await api.workspace.create(request({ path: first })))
    const secondResult = expectOk(await api.workspace.create(request({ path: second })))
    expect(firstResult).toMatchObject({
      created: true,
      workspace: { path: first, title: 'project' },
    })
    expect(secondResult).toMatchObject({
      created: true,
      workspace: { path: second, title: 'project' },
    })
    expect(secondResult.workspace.workspaceId).not.toBe(firstResult.workspace.workspaceId)
    expect(expectOk(await api.workspace.list(request({}))).items.map(workspace => workspace.path))
      .toEqual([second, first])
  })
})

describe('workspace.insertBefore', () => {
  it('commits the complete order, streams one order frame, and maps unknown ids', async () => {
    const { api, ctx, root } = await harness()
    const first = expectOk(await api.workspace.create(request({ path: stageDir(root, 'first') }))).workspace
    const second = expectOk(await api.workspace.create(request({ path: stageDir(root, 'second') }))).workspace
    const third = expectOk(await api.workspace.create(request({ path: stageDir(root, 'third') }))).workspace

    const abort = new AbortController()
    const listWorkspaces = vi.spyOn(ctx.workspaceRegistry, 'list')
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    const changed = nextHostFrame(stream)
    const reordered = expectOk(await api.workspace.insertBefore(request({
      workspaceId: first.workspaceId,
      beforeWorkspaceId: second.workspaceId,
    })))
    expect(reordered.workspaceIds).toEqual([third.workspaceId, first.workspaceId, second.workspaceId])
    expect(await changed).toMatchObject({
      payload: {
        type: 'host/workspace-order-changed',
        workspaceIds: [third.workspaceId, first.workspaceId, second.workspaceId],
      },
    })
    expect(expectOk(await api.workspace.list(request({}))).items.map(item => item.workspaceId))
      .toEqual(reordered.workspaceIds)

    const missingSource = await api.workspace.insertBefore(request({
      workspaceId: 'missing' as WorkspaceId,
    }))
    expect(missingSource.result).toMatchObject({
      ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'missing' } },
    })
    const missingAnchor = await api.workspace.insertBefore(request({
      workspaceId: first.workspaceId,
      beforeWorkspaceId: 'missing-anchor' as WorkspaceId,
    }))
    expect(missingAnchor.result).toMatchObject({
      ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'missing-anchor' } },
    })
    abort.abort()
  })
})

describe('session creation and Workspace membership', () => {
  it('attaches a preallocated idempotent session while cwd-only sessions stay ungrouped', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
    const sessionId = SessionId('session-workspace-preallocated')

    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    expect(expectOk(await api.workspace.list(request({}))).items[0]?.sessionIds).toEqual([sessionId])
    expect(ctx.agents.list().filter(agent => agent.id === sessionId)).toHaveLength(1)

    const ungrouped = SessionId('session-cwd-only')
    expectOk(await api.sessions.create(request({ cwd: workspace.path, sessionId: ungrouped })))
    expect(expectOk(await api.workspace.list(request({}))).items[0]?.sessionIds).toEqual([sessionId])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(ungrouped)

    const conflict = await api.sessions.create(request({ cwd: join(workspace.path, 'other'), sessionId }))
    expect(conflict.result).toMatchObject({
      ok: false,
      error: { code: 'session-conflict', details: { sessionId, existingCwd: workspace.path } },
    })
    const missing = await api.sessions.create(request({
      workspaceId: 'missing-workspace' as WorkspaceId,
      sessionId: SessionId('session-missing-workspace'),
    }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
  })

  it('retains a published session when attachment fails and repairs it on retry', async () => {
    const { api, ctx, root } = await harness()
    const created = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
    const workspace = ctx.workspaceRegistry.list()[0]
    if (workspace === undefined) throw new Error('workspace missing from registry')
    vi.spyOn(workspace, 'attachSession').mockRejectedValueOnce(new Error('simulated write failure'))
    const sessionId = SessionId('session-attach-retry')

    const failed = await api.sessions.create(request({ workspaceId: created.workspaceId, sessionId }))
    expect(failed.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-attach-failed', details: { sessionId, workspaceId: created.workspaceId } },
    })
    expect(ctx.agents.get(sessionId)).toBeDefined()

    expectOk(await api.sessions.create(request({ workspaceId: created.workspaceId, sessionId })))
    expect(expectOk(await api.workspace.list(request({}))).items[0]?.sessionIds).toEqual([sessionId])
  })
})

describe('Host Workspace increments', () => {
  it('projects subagent origin in attached summaries and creation increments', async () => {
    const { api, ctx } = await harness()
    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const pending = nextHostFrame(stream)
    const childId = SessionId('session-subagent-child')

    ctx.sessions.create(childId, {
      meta: {
        cwd: '/tmp',
        parentSession: SessionId('session-parent'),
        origin: 'subagent',
      },
    })

    expect(await pending).toMatchObject({
      payload: {
        type: 'host/session-added',
        sessionId: childId,
        parentSessionId: 'session-parent',
        origin: 'subagent',
      },
    })
    expect(expectOk(await api.sessions.list(request({}))).items).toContainEqual(
      expect.objectContaining({ sessionId: childId, origin: 'subagent' }),
    )
    abort.abort()
  })

  it('streams committed Workspace and Session increments after empty baselines', async () => {
    const { api, root } = await harness()
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items).toEqual([])

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const workspaceIncrement = nextHostFrame(stream)
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
    expect(await workspaceIncrement).toMatchObject({
      payload: { type: 'host/workspace-changed', workspace: { workspaceId: workspace.workspaceId } },
    })

    const sessionId = SessionId('session-streamed-workspace')
    const pending = nextHostFrame(stream)
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    const increments: HostFrame[] = []
    increments.push((await pending).payload)
    while (increments.length < 2) {
      const next = await stream.next()
      if (next.done === true) throw new Error('Host stream ended before both increments')
      increments.push(next.value.payload)
    }
    expect(increments.find(increment => increment.type === 'host/session-added')).toMatchObject({
      // A just-created session has no events: the frame constantly carries blank:true.
      type: 'host/session-added', sessionId, blank: true, cwd: workspace.path,
    })
    const workspaceChanged = increments.find(
      (increment): increment is Extract<HostFrame, { type: 'host/workspace-changed' }> =>
        increment.type === 'host/workspace-changed',
    )
    expect(workspaceChanged?.workspace.sessionIds).toEqual([sessionId])
    abort.abort()
  })

  it('does not publish a Workspace whose registry-order commit fails', async () => {
    const { api, storageDomain, root } = await harness()
    const domain = storageDomain.get('workspace')
    if (domain === undefined) throw new Error('workspace domain is not open')
    vi.spyOn(domain.global, 'set').mockRejectedValueOnce(new Error('simulated registry order failure'))
    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const next = stream.next()

    const failed = await api.workspace.create(request({ path: stageDir(root, 'ghost') }))
    expect(failed.result.ok).toBe(false)
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    abort.abort()
    expect(await next).toMatchObject({ done: true })
  })

  it('deletes the registration, keeps its session and folder, and streams one removal', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'delete-me') }))).workspace
    const sessionId = SessionId('session-kept-after-workspace-delete')
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const removed = nextHostFrame(stream)
    expectOk(await api.workspace.delete(request({ workspaceId: workspace.workspaceId })))
    expect(await removed).toMatchObject({
      payload: { type: 'host/workspace-removed', workspaceId: workspace.workspaceId },
    })
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)
    expect(ctx.agents.get(sessionId)).toBeDefined()
    expect(existsSync(workspace.path)).toBe(true)

    const missing = await api.workspace.delete(request({ workspaceId: workspace.workspaceId }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-not-found', details: { workspaceId: workspace.workspaceId } },
    })

    const reregistered = expectOk(await api.workspace.create(request({ path: workspace.path }))).workspace
    expect(reregistered.workspaceId).not.toBe(workspace.workspaceId)
    expect(reregistered.path).toBe(workspace.path)
    expect(reregistered.sessionIds).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)
    abort.abort()
  })

  it('archives a session into the global set, keeps its accounting, and streams the set once', async () => {
    const { api, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'archive-home') }))).workspace
    const sessionId = SessionId('session-to-archive')
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    expect(expectOk(await api.workspace.list(request({}))).archivedSessionIds).toEqual([])

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const changed = nextHostFrame(stream)
    expect(expectOk(await api.workspace.archiveSession(request({ sessionId }))).archivedSessionIds)
      .toEqual([sessionId])
    expect(await changed).toMatchObject({
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [sessionId] },
    })

    // Accounting and the session itself are untouched; list re-baselines the set.
    const listed = expectOk(await api.workspace.list(request({})))
    expect(listed.archivedSessionIds).toEqual([sessionId])
    expect(listed.items[0]?.sessionIds).toEqual([sessionId])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)

    // The idempotent repeat emits no second frame: the next observed frame is
    // the workspace-changed of a later attach, not another archive snapshot.
    const after = nextHostFrame(stream)
    expect(expectOk(await api.workspace.archiveSession(request({ sessionId }))).archivedSessionIds)
      .toEqual([sessionId])
    const otherSession = SessionId('session-after-archive')
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId: otherSession })))
    expect((await after).payload.type).not.toBe('host/archived-sessions-changed')

    const missing = await api.workspace.archiveSession(request({ sessionId: SessionId('session-ghost') }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'session-not-found', details: { sessionId: 'session-ghost' } },
    })
    abort.abort()
  })
})

describe('workspace federation handlers', () => {
  it('creates over validated members, lists in order, renames, and deletes idempotently', async () => {
    const { api, root } = await harness(undefined, undefined, { federatedWorkspacesEnabled: true })
    const a = stageDir(root, 'fed-a')
    const b = stageDir(root, 'fed-b')

    const created = expectOk(await api.workspace.createFederation(request({ memberPaths: [a, b] })))
    expect(created.created).toBe(true)
    expect(created.federation.title).toBe('fed-a + fed-b')
    expect(created.federation.memberPaths).toEqual([a, b])

    // The order rides the workspace.list value beside items and the archive set.
    const listed = expectOk(await api.workspace.list(request({})))
    expect(listed.federations.map(entry => entry.federationId)).toEqual([created.federation.federationId])
    expect(expectOk(await api.workspace.listFederations(request({}))).items).toHaveLength(1)

    const renamed = expectOk(await api.workspace.renameFederation(request({
      federationId: created.federation.federationId, title: 'Renamed',
    })))
    expect(renamed.federation.title).toBe('Renamed')
    expect(renamed.federation.updatedAt >= renamed.federation.createdAt).toBe(true)

    const removed = await api.workspace.deleteFederation(request({ federationId: created.federation.federationId }))
    expect(removed.result).toEqual({ ok: true, value: { deleted: true } })
    const afterDelete = await api.workspace.deleteFederation(request({ federationId: created.federation.federationId }))
    expect(afterDelete.result).toEqual({ ok: true, value: { deleted: true } })
  })

  it('flags vanished member directories on list instead of dropping the tolerant rows', async () => {
    const { api, root } = await harness(undefined, undefined, { federatedWorkspacesEnabled: true })
    const a = stageDir(root, 'probe-a')
    const b = stageDir(root, 'probe-b')

    // A workspace whose directory vanishes keeps its row (missing-dir
    // tolerance) and the list handler flags it.
    expectOk(await api.workspace.create(request({ path: a })))
    rmSync(a, { recursive: true, force: true })
    const listed = expectOk(await api.workspace.list(request({})))
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]?.missing).toBe(true)

    // A federation keeps its record and names the missing members only.
    const c = stageDir(root, 'probe-c')
    expectOk(await api.workspace.createFederation(request({ memberPaths: [b, c] })))
    rmSync(b, { recursive: true, force: true })
    const federations = expectOk(await api.workspace.listFederations(request({}))).items
    expect(federations).toHaveLength(1)
    expect(federations[0]?.missingMembers).toEqual([b])
    expect(expectOk(await api.workspace.list(request({}))).federations[0]?.missingMembers).toEqual([b])
  })

  it('refuses createFederation behind the gray switch while the durable rows still resolve', async () => {
    // Default harness: the switch is off (the deployment default).
    const { api, root } = await harness()
    const a = stageDir(root, 'off-a')
    const b = stageDir(root, 'off-b')

    const refused = await api.workspace.createFederation(request({ memberPaths: [a, b] }))
    expect(refused.result).toMatchObject({ ok: false, error: { code: 'federation-disabled' } })
    // The refusal left no record behind.
    expect(expectOk(await api.workspace.listFederations(request({}))).items).toHaveLength(0)

    // Resolution is never gated: rename/delete of a durable row (seeded by
    // flipping the switch on a fresh harness over the same assertions) would
    // work — here the paired truth is that the same members DO create once
    // the switch turns on.
    const enabled = await harness(realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-fed-on2-'))), undefined, {
      federatedWorkspacesEnabled: true,
    })
    const a2 = stageDir(enabled.root, 'off-a')
    const b2 = stageDir(enabled.root, 'off-b')
    expectOk(await enabled.api.workspace.createFederation(request({ memberPaths: [a2, b2] })))
  })

  it('maps membership validation and name conflicts to their wire codes', async () => {
    const { api, root } = await harness(undefined, undefined, { federatedWorkspacesEnabled: true })
    const a = stageDir(root, 'conf-a')
    const b = stageDir(root, 'conf-b')

    const invalidMembers = await api.workspace.createFederation(request({
      memberPaths: [a, join(root, 'missing-directory')],
    }))
    expect(invalidMembers.result).toMatchObject({
      ok: false,
      error: { code: 'federation-invalid-members', details: { path: join(root, 'missing-directory') } },
    })

    const c = stageDir(root, 'conf-c')
    expectOk(await api.workspace.createFederation(request({ title: 'Unique', memberPaths: [a, b] })))
    const conflict = await api.workspace.createFederation(request({ title: 'Unique', memberPaths: [b, c] }))
    expect(conflict.result).toMatchObject({
      ok: false,
      error: { code: 'federation-name-conflict', details: { title: 'Unique' } },
    })

    // The duplicate-title reject left no record behind.
    expect(expectOk(await api.workspace.listFederations(request({}))).items).toHaveLength(1)
  })

  it('answers rename on an unknown federation with federation-not-found', async () => {
    const { api } = await harness()
    const missing = await api.workspace.renameFederation(request({
      federationId: 'no-such-federation' as never, title: 'x',
    }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'federation-not-found', details: { federationId: 'no-such-federation' } },
    })
  })

  it('claims a federation identity: primary cwd, member roots, primary attach — behind the switch', async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-fed-claim-')))
    const off = await harness(root)
    const a = stageDir(root, 'claim-a')
    const b = stageDir(root, 'claim-b')
    expectOk(await off.api.workspace.create(request({ path: a })))
    // The identity became durable while the switch was on (another deployment
    // or an earlier boot); the wire gate sits above the registry, so the seed
    // goes through the registry directly.
    const seeded = await off.ctx.workspaceRegistry.createFederation({ memberPaths: [a, b] })

    // Switch OFF: a claim is refused before any session exists.
    const refused = await off.api.sessions.create(request({
      federationId: seeded.id as never,
      sessionId: SessionId('fed-refused'),
    }))
    expect(refused.result).toMatchObject({ ok: false, error: { code: 'federation-disabled' } })
    await off.ctx.fiber.dispose()

    // Switch ON (a second harness over the same in-memory medium would share
    // pool state only through the fixture; instead re-create the identity):
    const on = await harness(realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-fed-on-'))), undefined, {
      federatedWorkspacesEnabled: true,
    })
    const onPrimaryPath = stageDir(on.root, 'claim-a')
    const onSecondaryPath = join(on.root, 'claim-b')
    mkdirSync(onSecondaryPath)
    expectOk(await on.api.workspace.create(request({ path: onPrimaryPath })))
    const fedOn = expectOk(await on.api.workspace.createFederation(request({
      memberPaths: [onPrimaryPath, onSecondaryPath],
    })))

    const sessionId = SessionId('fed-claimed')
    expectOk(await on.api.sessions.create(request({
      federationId: fedOn.federation.federationId as never, sessionId,
    })))
    const stored = on.ctx.sessions.get(sessionId)
    expect(stored?.header.cwd).toBe(onPrimaryPath)
    expect(stored?.header.additionalRoots).toEqual([onSecondaryPath])
    // Primary attach groups the session under its owning workspace (fresh
    // list, not the pre-attach view row).
    const grouped = expectOk(await on.api.workspace.list(request({}))).items
      .find(item => item.path === onPrimaryPath)
    expect(grouped?.sessionIds.map(item => String(item))).toContain(String(sessionId))
    await on.ctx.fiber.dispose()
  })

  it('answers an unknown federation claim with federation-not-found', async () => {
    const { api } = await harness(undefined, undefined, { federatedWorkspacesEnabled: true })
    const missing = await api.sessions.create(request({
      federationId: 'ghost-federation' as never,
      sessionId: SessionId('fed-ghost'),
    }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'federation-not-found', details: { federationId: 'ghost-federation' } },
    })
  })
})
