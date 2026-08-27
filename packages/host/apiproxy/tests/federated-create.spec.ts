/**
 * Federated-workspace creation paths of the host ApiProxy: the gray switch,
 * membership validation against real filesystem identities, durable header
 * fixation through the agent meta channel, and the identity-conflict
 * extension covering additional roots.
 */

import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { describe, expect, it } from 'vitest'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`fed-${String(nextRpc++)}`), payload }
}

function header(id: string, createdAt: number, extra: Partial<SessionHeader> = {}): SessionHeader {
  return { version: 0, id: sid(id), createdAt, cwd: '/proj', ...extra }
}

function newRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `dsh-fed-${label}-`))
}

function newRealDir(label: string): string {
  return realpathSync.native(newRoot(label))
}

/** Minimal AgentFactory double: the gateway only folds identity + setup here. */
function stubFactory(ctx: Context): void {
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('no persisted sessions in this bench')
    },
  }
  ctx.agents.setFactory(factory)
}

async function enabledHarness(): Promise<{ ctx: Context; api: ReturnType<typeof buildApi> }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  stubFactory(ctx)
  return { ctx, api: buildApi(ctx) }
}

function buildApi(ctx: Context) {
  return createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
    federatedWorkspacesEnabled: true,
  })
}

describe('federated sessions.create gray switch', () => {
  it('rejects a roots claim while disabled without touching the filesystem', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    const parent = newRealDir('gate')
    const neverCreated = join(parent, 'proj-that-must-not-exist')
    const member = newRealDir('gate-member')
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp',
      federatedWorkspacesEnabled: false,
    })

    const refused = await api.sessions.create(request({
      sessionId: sid('fed-disabled'), cwd: neverCreated, additionalRoots: [member],
    }))
    expect(refused.result.ok).toBe(false)
    if (!refused.result.ok) expect(refused.result.error.code).toBe('federation-disabled')
    expect(existsSync(neverCreated)).toBe(false)
  })
})

describe('federated sessions.create membership validation', () => {
  it('rejects a missing directory', async () => {
    const { api } = await enabledHarness()
    const cwd = newRealDir('valid-cwd')
    const response = await api.sessions.create(request({
      sessionId: sid('fed-missing'), cwd,
      additionalRoots: [join(newRoot('miss-root'), 'absent')],
    }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('federation-invalid-members')
  })

  it('rejects a member pointing at a file', async () => {
    const { api } = await enabledHarness()
    const cwd = newRealDir('file-cwd')
    const filePath = join(newRoot('file-root'), 'plain.txt')
    writeFileSync(filePath, 'not a directory')
    const response = await api.sessions.create(request({
      sessionId: sid('fed-file-member'), cwd, additionalRoots: [filePath],
    }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('federation-invalid-members')
  })

  it('rejects duplicate members after canonicalization', async () => {
    const { api } = await enabledHarness()
    const cwd = newRealDir('dup-cwd')
    const member = newRealDir('dup-member')
    const response = await api.sessions.create(request({
      sessionId: sid('fed-dup'), cwd, additionalRoots: [member, member],
    }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('federation-invalid-members')
  })

  it('rejects a member equal to the project cwd', async () => {
    const { api } = await enabledHarness()
    const cwd = newRealDir('same-cwd')
    const response = await api.sessions.create(request({
      sessionId: sid('fed-eq-cwd'), cwd, additionalRoots: [cwd],
    }))
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('federation-invalid-members')
  })
})

describe('federated sessions.create fixation and empty-list semantics', () => {
  it('fixes canonical members onto the created session header verbatim', async () => {
    const { api, ctx } = await enabledHarness()
    const cwd = newRealDir('fix-cwd')
    const memberRaw = newRoot('fix-member')
    const memberCanonical = realpathSync.native(memberRaw)

    const response = await api.sessions.create(request({
      sessionId: sid('fed-fixed'), cwd, additionalRoots: [memberRaw],
    }))
    expect(response.result.ok).toBe(true)
    const stored = ctx.sessions.get(sid('fed-fixed'))
    expect(stored?.header.cwd).toBe(cwd)
    // The claim arrives as a user spelling; the durable list is canonical.
    expect(stored?.header.additionalRoots).toEqual([memberCanonical])
  })

  it('treats an empty list exactly like an absent field', async () => {
    const { api, ctx } = await enabledHarness()
    const cwd = newRealDir('empty-list-cwd')

    const first = await api.sessions.create(request({
      sessionId: sid('fed-empty-list'), cwd, additionalRoots: [],
    }))
    expect(first.result.ok).toBe(true)
    const stored = ctx.sessions.get(sid('fed-empty-list'))
    expect(stored !== undefined && 'additionalRoots' in stored.header).toBe(false)

    // The unclaimed retry is NOT a conflicting claim: it resumes unchanged.
    const second = await api.sessions.create(request({
      sessionId: sid('fed-empty-list'), cwd,
    }))
    expect(second.result.ok).toBe(true)
  })
})

describe('federated identity conflict over additional roots', () => {
  it('answers a mismatching claim over a persisted federated identity with session-conflict', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const storedMember = realpathSync.native(newRoot('conf-persisted-member'))
    const claimedMember = realpathSync.native(newRoot('conf-persisted-claim'))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([header('fed-resume', 1000)]),
      inspect: () => Promise.resolve({
        meta: header('fed-resume', 1000, { additionalRoots: [storedMember] }),
        events: [
          { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        ],
      }),
      locate: () => undefined,
    } as never)
    const api = buildApi(ctx)

    const conflicting = await api.sessions.create(request({
      sessionId: sid('fed-resume'), cwd: '/proj',
      additionalRoots: [claimedMember],
    }))
    expect(conflicting.result.ok).toBe(false)
    if (!conflicting.result.ok) {
      expect(conflicting.result.error.code).toBe('session-conflict')
      expect(conflicting.result.error.message).toContain('additional roots differ')
      expect(conflicting.result.error.details).toMatchObject({
        requestedAdditionalRoots: [claimedMember],
        existingAdditionalRoots: [storedMember],
      })
    }
    // The exact-durable-claim adopt lives in the live-identity case below;
    // a full persisted adoption would need a composed resume this bench
    // deliberately does not mount.
  })

  it('answers a mismatching claim over a LIVE federated identity with session-conflict', async () => {
    const { api, ctx } = await enabledHarness()
    const liveMember = realpathSync.native(newRoot('conf-live-member'))
    const claimMember = realpathSync.native(newRoot('conf-live-claim'))
    const created = await api.sessions.create(request({
      sessionId: sid('fed-live'), cwd: '/proj-live', additionalRoots: [liveMember],
    }))
    expect(created.result.ok).toBe(true)

    const conflicting = await api.sessions.create(request({
      sessionId: sid('fed-live'), cwd: '/proj-live', additionalRoots: [claimMember],
    }))
    expect(conflicting.result.ok).toBe(false)
    if (!conflicting.result.ok) {
      expect(conflicting.result.error.code).toBe('session-conflict')
      expect(conflicting.result.error.message).toContain('additional roots differ')
    }

    // A claim reproducing the durable list is accepted as an idempotent adopt.
    const matching = await api.sessions.create(request({
      sessionId: sid('fed-live'), cwd: '/proj-live', additionalRoots: [liveMember],
    }))
    expect(matching.result.ok).toBe(true)
    expect(ctx.agents.get(sid('fed-live'))?.session.header.additionalRoots).toEqual([liveMember])
  })
})
