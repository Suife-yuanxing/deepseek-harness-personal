import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { CallId } from '@deepseek-ai/dsh-llm'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import * as agentSpine from '../src/index.ts'

let ctx: Context | undefined
let projectA: string
let projectB: string
let projectC: string
const tempDirs: string[] = []

async function projectDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(homedir(), `dsh-${label}-`))
  tempDirs.push(dir)
  return dir
}

async function expectMissing(path: string): Promise<void> {
  await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
}

function resultText(result: ToolResult): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

beforeEach(async () => {
  projectA = await projectDir('fed-a')
  projectB = await projectDir('fed-b')
  projectC = await projectDir('fed-c')
  const fallbackRoot = await projectDir('fallback')

  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: fallbackRoot })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SandboxBashExecutor, { cwd: fallbackRoot, timeoutMs: 30_000 })
  await ctx.plugin(SandboxedFileSystem, { cwd: fallbackRoot })
  await ctx.plugin(agentSpine, {
    workspaceContext: false,
    skills: { enabled: false },
    toolBash: { enableRunInBackground: false },
    toolJobs: false,
  })
  await new Promise(resolve => setTimeout(resolve, 50))
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function federatedAgent(): Promise<NonNullable<Context['agents']>['get'] extends never ? never : Awaited<ReturnType<Context['agents']['create']>>['agent']> {
  const handle = await (ctx as Context).agents.create({
    sessionId: SessionId('federated-session'),
    // The wire contract the gateway uses: primary first, members canonical.
    meta: { cwd: projectA, additionalRoots: [projectB] },
  })
  return handle.agent
}

async function plainAgent(): Promise<Awaited<ReturnType<Context['agents']['create']>>['agent']> {
  const handle = await (ctx as Context).agents.create({
    sessionId: SessionId('plain-session'),
    meta: { cwd: projectC },
  })
  return handle.agent
}

describe('one-context federated workspace (REAL composition)', () => {
  it('writes relative paths into the primary root and absolute paths into a member root', async () => {
    const agent = await federatedAgent()
    const [relative, crossMember, outsider] = await Promise.all([
      (ctx as Context).tools.execute({
        callId: CallId('fed-fs-relative'), name: 'write', agent,
        signal: new AbortController().signal,
        arguments: { file_path: 'primary-owned.txt', content: 'primary' },
      }),
      (ctx as Context).tools.execute({
        callId: CallId('fed-fs-member'), name: 'write', agent,
        signal: new AbortController().signal,
        arguments: { file_path: join(projectB, 'member-owned.txt'), content: 'member' },
      }),
      (ctx as Context).tools.execute({
        callId: CallId('fed-fs-outsider'), name: 'write', agent,
        signal: new AbortController().signal,
        arguments: { file_path: join(projectC, 'must-not-exist.txt'), content: 'outside' },
      }),
    ])

    expect(relative.isError).toBe(false)
    expect(crossMember.isError).toBe(false)
    expect(outsider.isError).toBe(true)
    expect(resultText(outsider)).toContain('[sandbox: file access denied under workspace-write mode]')
    // A relative path resolves against the PRIMARY root, never a sibling.
    expect(await readFile(join(projectA, 'primary-owned.txt'), 'utf8')).toBe('primary')
    await expectMissing(join(projectB, 'primary-owned.txt'))
    expect(await readFile(join(projectB, 'member-owned.txt'), 'utf8')).toBe('member')
    await expectMissing(join(projectC, 'must-not-exist.txt'))
  })

  it('renders the multi-root policy sentence and keeps an ordinary session byte-compatible', async () => {
    const fed = await federatedAgent()
    const assembly = await (ctx as Context).systemPrompt.assemble({ agent: fed })
    const text = assembly.contexts.find(context => context.name === 'sandbox:policy')?.text
    expect(text).toContain('session workspace roots:')
    expect(text).toContain(JSON.stringify([resolve(projectA), resolve(projectB)]))
    expect(text).toContain("The first root is the session's working directory for relative paths")
    // The resolved policy is model-visible ⟺ logged: the runtime-context
    // snapshot carries the exact rendered context.
    const snapshotText = JSON.stringify(assembly)
    expect(snapshotText).toContain('session workspace roots')

    const plain = await plainAgent()
    const plainAssembly = await (ctx as Context).systemPrompt.assemble({ agent: plain })
    const plainText = plainAssembly.contexts.find(context => context.name === 'sandbox:policy')?.text
    expect(plainText).toBe(
      'Current DSH file policy: workspace-write. Any available operation enforced by the DSH '
      + `file sandbox may modify files under the session workspace: ${JSON.stringify(resolve(projectC))}. `
      + 'Some platform temporary areas may also be writable.',
    )
  })
})
