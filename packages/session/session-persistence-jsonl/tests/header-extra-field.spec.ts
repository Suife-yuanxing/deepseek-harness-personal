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
 * Federated-workspace phase-0 probe (plan task 0.1): prove how THIS build's
 * v0 loader treats a first-line header that carries an extra array field a
 * FUTURE writer emits (`additionalRoots`, spelled per the federated-workspace
 * spec). The outcome decides between the conservative route (optional header
 * field, no SESSION_FORMAT_VERSION bump) and the version-bump fallback route.
 */

const dirs: string[] = []

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fed-probe-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('federated workspace probe: unknown optional header field', () => {
  it('loads a v0 log whose header carries an additionalRoots-shaped unknown field', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    try {
      const m = meta('fed-probe', '/work')
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())

      // Splice the future-writer field into the SAME v0 header shape on disk,
      // mirroring exactly what a shipped federated-workspace build would write.
      const path = logPath(resolve(root), '/work', m.id, 'none')
      const lines = (await readFile(path, 'utf8')).split('\n')
      const header = JSON.parse(lines[0]!) as Record<string, unknown>
      expect(header.type).toBe('session')
      expect(header.version).toBe(0)
      header.additionalRoots = ['D:/federation-b']
      lines[0] = JSON.stringify(header)
      await writeFile(path, lines.join('\n'))

      // Decision point A vs B: the loader either accepts the log (A) or
      // refuses it as unsupported/corrupt (B). Route A keeps the conservative
      // no-bump plan viable.
      const loaded = await ctx.sessionPersistence.load(m.id)
      expect(loaded.events.map(event => event.type))
        .toEqual(oneTurnLog().map(event => event.type))
      // Document the current-reader disposition: until this harness declares
      // the field, an unknown member is not projected onto the typed header.
      expect(
        (loaded.meta as typeof loaded.meta & { additionalRoots?: unknown }).additionalRoots,
      ).toBeUndefined()

      // The whole-list read must not degrade either: an enriched header line
      // stays a recognizable session row with its recorded cwd intact.
      const listed = (await ctx.sessionPersistence.list()).find(entry => entry.id === m.id)
      expect(listed?.cwd).toBe('/work')
    } finally {
      await fiber.dispose()
    }
  })

  it('still reads the log when the injected field rides after agentPreset', async () => {
    const root = await freshRoot()
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    try {
      const m = { ...meta('fed-probe-preset', '/work'), agentPreset: 'standard' }
      await ctx.sessionPersistence.create(m)
      await ctx.sessionPersistence.append(m.id, oneTurnLog())

      const path = logPath(resolve(root), '/work', m.id, 'none')
      const lines = (await readFile(path, 'utf8')).split('\n')
      const header = JSON.parse(lines[0]!) as Record<string, unknown>
      header.agentPreset = 'standard'
      header.additionalRoots = ['D:/b1', 'D:/b2']
      lines[0] = JSON.stringify(header)
      await writeFile(path, lines.join('\n'))

      const failure = await ctx.sessionPersistence.load(m.id).then(
        () => undefined,
        (error: unknown) => error as Error,
      )
      expect(failure?.name).not.toBe('SessionFormatUnsupportedError')
      expect(await ctx.sessionPersistence.load(m.id)).toMatchObject({
        meta: { id: m.id, agentPreset: 'standard' },
      })
    } finally {
      await fiber.dispose()
    }
  })
})
