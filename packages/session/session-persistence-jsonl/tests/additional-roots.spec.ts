import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { logPath } from '../src/format.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'

/**
 * Federated-workspace artifact evidence (plan phase 0 probe → phase 1
 * support): a session's additional workspace roots live inside the SAME v0
 * first-line header shape — no SESSION_FORMAT_VERSION bump for the field.
 * Phase 0 proved this loader merely TOLERATED such a line before support;
 * these tests pin the supported behavior: explicit writer emission, verbatim
 * read-back through load() and list(), guard rejection of malformed members,
 * and store-level absolute-path enforcement.
 */

const dirs: string[] = []

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fed-roots-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function mounted(root: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return { ctx, fiber }
}

describe('JsonlSessionPersistence: additional roots in the v0 header', () => {
  it('writes additionalRoots into the first line without bumping the format version', async () => {
    const root = await freshRoot()
    const { ctx, fiber } = await mounted(root)
    try {
      const rootB = join(tmpdir(), 'fed-jsonl-b')
      const m = { ...meta('fed-roots', '/work'), additionalRoots: [rootB] }
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())

      const path = logPath(resolve(root), '/work', m.id, 'none')
      const lines = (await readFile(path, 'utf8')).split('\n')
      const header = JSON.parse(lines[0]!) as Record<string, unknown>
      expect(header.type).toBe('session')
      expect(header.version).toBe(0)
      expect(header.additionalRoots).toEqual([rootB])

      const loaded = await ctx.sessionPersistence.load(m.id)
      expect(loaded.meta.additionalRoots).toEqual([rootB])
      expect(loaded.events.map(event => event.type))
        .toEqual(oneTurnLog().map(event => event.type))
    } finally {
      await fiber.dispose()
    }
  })

  it('keeps an enriched first line recognizable to list()', async () => {
    const root = await freshRoot()
    const { ctx, fiber } = await mounted(root)
    try {
      const rootB = join(tmpdir(), 'fed-jsonl-list-b')
      const m = { ...meta('fed-listed', '/work'), additionalRoots: [rootB] }
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())

      const listed = (await ctx.sessionPersistence.list()).find(entry => entry.id === m.id)
      expect(listed?.cwd).toBe('/work')
      expect(listed?.additionalRoots).toEqual([rootB])
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects a non-string member as a corrupt header before any event row parses', async () => {
    const root = await freshRoot()
    const { ctx, fiber } = await mounted(root)
    try {
      const m = meta('fed-bad-member', '/work')
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())

      const path = logPath(resolve(root), '/work', m.id, 'none')
      const lines = (await readFile(path, 'utf8')).split('\n')
      const header = JSON.parse(lines[0]!) as Record<string, unknown>
      header.additionalRoots = [7]
      lines[0] = JSON.stringify(header)
      await writeFile(path, lines.join('\n'))

      await expect(ctx.sessionPersistence.load(m.id))
        .rejects.toThrow(/first line is not a session header/)
    } finally {
      await fiber.dispose()
    }
  })

  it('defers absolute-path enforcement to the session-store validation on restore', async () => {
    const root = await freshRoot()
    const { ctx, fiber } = await mounted(root)
    try {
      // A relative member passes the artifact-level shape guard (which checks
      // member types only) and is rejected by the authoritative header
      // validation when the log becomes a session again.
      const m = meta('fed-relative-member', '/work')
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())

      const path = logPath(resolve(root), '/work', m.id, 'none')
      const lines = (await readFile(path, 'utf8')).split('\n')
      const header = JSON.parse(lines[0]!) as Record<string, unknown>
      header.additionalRoots = ['relative/b']
      lines[0] = JSON.stringify(header)
      await writeFile(path, lines.join('\n'))

      await expect(ctx.sessionPersistence.load(m.id))
        .rejects.toThrow(/additionalRoots entries must be absolute paths/)
    } finally {
      await fiber.dispose()
    }
  })

  it('emits no field for an ordinary session (byte-shape stability)', async () => {
    const root = await freshRoot()
    const { ctx, fiber } = await mounted(root)
    try {
      const m = meta('fed-plain', '/work')
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())

      const lines = (await readFile(logPath(resolve(root), '/work', m.id, 'none'), 'utf8')).split('\n')
      expect(Object.hasOwn(JSON.parse(lines[0]!) as Record<string, unknown>, 'additionalRoots')).toBe(false)
    } finally {
      await fiber.dispose()
    }
  })
})
