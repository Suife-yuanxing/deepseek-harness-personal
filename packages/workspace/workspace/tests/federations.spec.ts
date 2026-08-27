import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import type { StorageBackend } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry from '../src/index.ts'
import {
  FederationInvalidMembersError,
  FederationNameConflictError,
  FederationUnknownError,
} from '../src/index.ts'

const DOMAIN_VERSION = 2

interface HarnessOptions {
  pool?: MemoryMediaPool
  backend?: StorageBackend
}

/** Boot the real storage/domain/registry composition over an empty session peer. */
async function harness(options: HarnessOptions = {}) {
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', options.backend ?? new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)

  const changes: DomainChanged[] = []
  ctx.on('domain/changed', (change: DomainChanged) => { changes.push(change) })
  const fiber = await ctx.plugin(WorkspaceRegistry)
  return { ctx, fiber, pool, registry: ctx.workspaceRegistry }
}

let base: string | undefined
const tempDirs: string[] = []

async function makeDir(name: string): Promise<string> {
  base ??= await realpath(await mkdtemp(join(tmpdir(), 'dsh-federation-')))
  if (tempDirs.length === 0) tempDirs.push(base)
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  return dir
}

afterEach(async () => {
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

describe('federation registry CRUD', () => {
  it('creates over canonical members in creation order with the joined default title', async () => {
    const { registry, fiber } = await harness()
    try {
      const a = await makeDir('alpha')
      const bDir = await makeDir('beta')
      const fed = await registry.createFederation({ memberPaths: [a, bDir] })

      expect(fed.title).toBe('alpha + beta')
      expect(fed.memberPaths).toEqual([a, bDir])
      expect(Object.isFrozen(fed)).toBe(true)
      expect(Object.isFrozen(fed.memberPaths)).toBe(true)
      expect(registry.listFederations().map(entry => entry.id)).toEqual([fed.id])
    } finally {
      await fiber.dispose()
    }
  })

  it('trims explicit titles, keeps them unique, and no-ops on the same title', async () => {
    const { registry, fiber } = await harness()
    try {
      const a = await makeDir('t-one')
      const b = await makeDir('t-two')
      const c = await makeDir('t-three')
      const first = await registry.createFederation({ title: '  Front + Back  ', memberPaths: [a, b] })

      await expect(registry.createFederation({ title: 'Front + Back', memberPaths: [b, c] }))
        .rejects.toBeInstanceOf(FederationNameConflictError)

      const renamed = await registry.renameFederation(first.id, first.title)
      expect(renamed.updatedAt).toBe(first.updatedAt)

      const second = await registry.renameFederation(first.id, 'Renamed')
      expect(second.title).toBe('Renamed')
      // Unknown-id rejection lives in the deletion case below; a live id may
      // freely take any unused title.
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects membership lists that fail canonical validation', async () => {
    const { registry, fiber } = await harness()
    try {
      const only = await makeDir('single')
      const real = await makeDir('real-member')

      await expect(registry.createFederation({ memberPaths: [only] }))
        .rejects.toBeInstanceOf(FederationInvalidMembersError)
      await expect(registry.createFederation({
        memberPaths: [only, join(only, 'missing-child')],
      })).rejects.toBeInstanceOf(FederationInvalidMembersError)
      await expect(registry.createFederation({ memberPaths: [real, real] }))
        .rejects.toMatchObject({ reason: /duplicate member/ })
      expect(registry.listFederations()).toEqual([])
    } finally {
      await fiber.dispose()
    }
  })

  it('deletes durably and answers unknown ids idempotently', async () => {
    const { registry, fiber } = await harness()
    try {
      const a = await makeDir('del-a')
      const b = await makeDir('del-b')
      const fed = await registry.createFederation({ memberPaths: [a, b] })

      expect(await registry.deleteFederation(fed.id)).toBe(true)
      expect(registry.listFederations()).toEqual([])
      expect(await registry.deleteFederation(fed.id)).toBe(false)
      await expect(registry.renameFederation(fed.id, 'zombie')).rejects.toBeInstanceOf(FederationUnknownError)
    } finally {
      await fiber.dispose()
    }
  })

  it('upgrades pre-federation media whose global state omits federationIds entirely', async () => {
    // Fixture shape mirrors workspace.spec's storedPool: tables present, the
    // new order field absent — the schema default must upgrade it on open.
    const pool = new MemoryMediaPool()
    pool.versions.set('workspace', DOMAIN_VERSION)
    pool.media.set('workspace', {
      tables: new Map<string, Map<string, unknown>>([
        ['workspaces', new Map()],
        ['federations', new Map()],
      ]),
      global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
    })
    const { registry, fiber } = await harness({ pool })
    try {
      expect(registry.listFederations()).toEqual([])
      const a = await makeDir('legacy-a')
      const b = await makeDir('legacy-b')
      const fed = await registry.createFederation({ memberPaths: [a, b] })
      expect(registry.listFederations().map(entry => entry.id)).toEqual([fed.id])
    } finally {
      await fiber.dispose()
    }
  })
})
