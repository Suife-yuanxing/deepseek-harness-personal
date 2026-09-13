import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { LocalCredentialProvider } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

describe('resolveAll', () => {
  it('enumerates the document plus credential-shaped .env entries, honoring precedence and skipping empties', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-resolveall-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, '.credentials.yaml')
    await writeFile(path, 'DSH_CRED_DOC: doc-value-0123456789\n', 'utf8')
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DSH_CRED_PROC: 'proc-value-0123456789' } },
      { source: 'user-env', values: { DSH_CRED_USER_KEY: 'user-value-012345678', DSH_CRED_EMPTY: '', APP_NAME: 'not-a-credential-name' } },
      { source: 'project-env', values: { DSH_CRED_USER_KEY: 'project-value-01234567', DSH_CRED_NAME: 'name-value-012345678' } },
    ]))
    const fiber = ctx.plugin(LocalCredentialProvider, { path, watch: false })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber
    const all = await (ctx.credentials as LocalCredentialProvider).resolveAll()
    const byRef = Object.fromEntries(all.map(e => [e.ref, e]))
    expect(byRef.DSH_CRED_DOC).toEqual({ ref: 'DSH_CRED_DOC', source: 'file', value: 'doc-value-0123456789' })
    expect(byRef.DSH_CRED_NAME).toEqual({ ref: 'DSH_CRED_NAME', source: 'project-env', value: 'name-value-012345678' })
    expect(byRef.DSH_CRED_USER_KEY).toEqual({ ref: 'DSH_CRED_USER_KEY', source: 'project-env', value: 'project-value-01234567' })
    expect(byRef.DSH_CRED_EMPTY).toBeUndefined() // empty stored value is absent everywhere
    expect(byRef.DSH_CRED_PROC).toBeUndefined() // the inherited environment is not enumerable
    expect(byRef.APP_NAME).toBeUndefined() // non-credential-shaped names stay out
  })

  it('is empty when nothing is stored anywhere', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cred-resolveall-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    const ctx = new Context()
    const fiber = ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber
    expect(await (ctx.credentials as LocalCredentialProvider).resolveAll()).toEqual([])
  })
})
