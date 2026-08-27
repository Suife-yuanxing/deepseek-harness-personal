import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as WorkspaceInvariant from '../src/invariant.ts'
import { WorkspaceId } from '../src/index.ts'

/** Boot the invariant service plus the companion over a stubbed registry knowing exactly `ids`. */
async function setup(ids: string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => (ids.includes(id) ? { id } : undefined),
  })
  await ctx.plugin(WorkspaceInvariant)
  return ctx
}

type ChangeLocation = Partial<Pick<DomainChanged, 'domain' | 'table' | 'key'>>

const put = (overrides?: ChangeLocation): DomainChanged => ({
  domain: 'workspace',
  table: 'workspaces',
  key: 'w1',
  operation: 'put',
  value: {},
  ...overrides,
})

const deleted = (): DomainChanged => ({
  domain: 'workspace',
  table: 'workspaces',
  key: 'w1',
  operation: 'deleted',
})

describe('workspace cache/table invariant', () => {
  it('accepts a put whose record has a cached entity and ignores foreign events', async () => {
    const ctx = await setup(['w1'])
    expect(() => { ctx.emit('domain/changed', put()) }).not.toThrow()
    // Other domains and other tables are out of scope, whatever their shape.
    expect(() => { ctx.emit('domain/changed', put({ domain: 'other', key: 'missing' })) }).not.toThrow()
    expect(() => { ctx.emit('domain/changed', put({ table: 'other', key: 'missing' })) }).not.toThrow()
  })

  it('fails deletion while the registry still publishes the entity', async () => {
    const ctx = await setup(['w1'])
    expect(() => { ctx.emit('domain/changed', deleted()) })
      .toThrow(/cache still publishes/)
  })

  it('allows deletion after the registry removed the cache entry for rollback or explicit deletion', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', deleted()) }).not.toThrow()
  })

  it('fails a put whose record the registry cache does not hold', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', put()) }).toThrow(/diverged/)
  })
})

describe('federation record invariant', () => {
  const fedPut = (overrides?: {
    key?: string
    memberPaths?: string[]
    ordered?: boolean
  }): DomainChanged => ({
    domain: 'workspace',
    table: 'federations',
    key: overrides?.key ?? 'f1',
    operation: 'put',
    value: { title: 't', memberPaths: overrides?.memberPaths ?? ['/a', '/b'], createdAt: '', updatedAt: '' },
  })

  async function federationSetup(orderIds: string[]): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    ctx.provide('workspaceRegistry', {
      get: () => undefined,
      listFederations: () => orderIds.map(id => ({ id })),
    })
    await ctx.plugin(WorkspaceInvariant)
    return ctx
  }

  it('accepts a well-formed two-member put referenced by the durable order', async () => {
    const ctx = await federationSetup(['f1'])
    expect(() => { ctx.emit('domain/changed', fedPut()) }).not.toThrow()
  })

  it('fails a malformed membership row (fewer than two distinct entries)', async () => {
    const ctx = await federationSetup(['f1'])
    expect(() => { ctx.emit('domain/changed', fedPut({ memberPaths: ['/a'] })) }).toThrow(/two or more distinct/)
    expect(() => { ctx.emit('domain/changed', fedPut({ memberPaths: ['/a', '/a'] })) }).toThrow(/two or more distinct/)
  })

  it('fails a well-formed row the durable order does not reference', async () => {
    const ctx = await federationSetup(['other'])
    expect(() => { ctx.emit('domain/changed', fedPut()) }).toThrow(/order does .*not.* reference|diverged/)
  })

  it('ignores deleted rows and foreign tables for federations', async () => {
    const ctx = await federationSetup([])
    expect(() => { ctx.emit('domain/changed', {
      domain: 'workspace', table: 'federations', key: 'gone', operation: 'deleted',
    }) }).not.toThrow()
  })
})
