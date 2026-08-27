/**
 * The win32 chain's argv contract, denial dialect, and runner-failure rules,
 * exercised through the REAL LocalSandboxProvider.confine() with an injected
 * platform and runner argv prefix. Platform-independent assertions: they run
 * in every CI lane (Windows included, where sandbox-local's own POSIX-only
 * suites are excluded) — the end-to-end runner behavior lives in
 * runner.spec.ts on win32 hosts.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

const RO: SandboxPolicy = { mode: 'read-only', workspaceRoot: '/ws' }
const WW: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: '/ws' }

/** Cross-file state shared with the vi.mock factory (hoisting contract). */
const mockState = vi.hoisted(() => ({
  grants: [] as Array<{ writeSid: string; added: Array<{ path: string; standing: boolean }> }>,
}))

vi.mock('@deepseek-ai/dsh-sandbox-windows-acl', () => {
  class MockAclWriteGrant {
    readonly added: Array<{ path: string; standing: boolean }> = []
    constructor(readonly writeSid: string) {
      mockState.grants.push({ writeSid, added: this.added })
    }
    static create(writeSid: string): MockAclWriteGrant {
      return new MockAclWriteGrant(writeSid)
    }
    add(path: string, standing = false): void {
      this.added.push({ path, standing })
    }
    dispose(): void {}
  }
  return {
    AclWriteGrant: MockAclWriteGrant,
    assertTempRootOutsideWorkspace: (workspaceRoot: string, tempRoot: string) => {
      if (tempRoot === workspaceRoot || tempRoot.startsWith(`${workspaceRoot}\\`)) {
        throw new Error(`Windows ACL temp root must be outside the workspace: workspace=${workspaceRoot}; temp=${tempRoot}`)
      }
    },
    // Deterministic distinct identities per path keep the positional pairing
    // assertions honest without importing the real hash in the factory.
    workspaceWriteSid: (path: string) => `SID:${path}`,
    tempWriteSid: (path: string) => `TEMP:${path}`,
  }
})

async function setup(internals: LocalSandboxProvider['internals']) {
  const ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = internals
  return sandbox
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index < 0 ? undefined : argv[index + 1]
}

/** Real directories so the seam's boundary assertion can canonicalize them. */
const scratch: string[] = []
beforeEach(() => {
  mockState.grants.length = 0
})
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('windows-acl win32 chain (LocalSandboxProvider)', () => {
  it('agentless workspace-write: runner argv prefix, temp root, mode flag, partial enforcement, ACL denial dialect', async () => {
    const probeWindowsAcl = vi.fn(() => true)
    const sandbox = await setup({
      platform: 'win32',
      windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
      probeWindowsAcl,
    })
    const confined = sandbox.confine(['pwsh', '/Command', 'x'], WW)
    expect(confined.argv).toEqual([
      'node', 'windows-acl-runner.js',
      '--workspace', '/ws',
      '--temp', tmpdir(),
      '--mode', 'workspace-write',
      '--',
      'pwsh', '/Command', 'x',
    ])
    expect(confined.enforcement).toBe('partial')
    expect(confined.denialSignatures).toEqual(['access is denied', 'access to the path', 'permission denied'])
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
    // A sole candidate is selected unprobed.
    expect(probeWindowsAcl).not.toHaveBeenCalled()
  })

  it('read-only: same runner and contract, read-only mode flag', async () => {
    const sandbox = await setup({ platform: 'win32', windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'] })
    const confined = sandbox.confine(['true'], RO)
    expect(confined.argv.slice(-4)).toEqual(['--mode', 'read-only', '--', 'true'])
    expect(confined.enforcement).toBe('partial')
    expect(confined.runnerFailureRules).toEqual([{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }])
  })

  describe('federation roots', () => {
    it('carries one --writable-root per member and stands each member under its own identity', async () => {
      const primary = mkdtempSync(join(tmpdir(), 'dsh-fed-primary-'))
      const member = mkdtempSync(join(tmpdir(), 'dsh-fed-member-'))
      scratch.push(primary, member)
      const sandbox = await setup({
        platform: 'win32',
        windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
        probeWindowsAcl: () => true,
      })
      const policy: SandboxPolicy = {
        mode: 'workspace-write',
        workspaceRoot: primary,
        additionalRoots: [member],
        sessionId: SessionId('fed-session'),
      }

      const confined = sandbox.confine(['pwsh', '/Command', 'x'], policy)
      const tempDir = flag(confined.argv, '--temp')
      expect(confined.argv).toEqual([
        'node', 'windows-acl-runner.js',
        '--workspace', primary,
        '--writable-root', member,
        '--temp', tempDir,
        '--mode', 'workspace-write',
        '--write-sid', `SID:${primary}`,
        '--temp-write-sid', `TEMP:${tempDir}`,
        '--',
        'pwsh', '/Command', 'x',
      ])
      // Two standing member identities plus one revocable shared private temp.
      expect([...mockState.grants]).toEqual([
        { writeSid: `SID:${primary}`, added: [{ path: primary, standing: true }] },
        { writeSid: `SID:${member}`, added: [{ path: member, standing: true }] },
        { writeSid: `TEMP:${tempDir}`, added: [{ path: tempDir, standing: false }] },
      ])

      // The repeat call reuses both standing roots and the same session temp.
      const second = sandbox.confine(['true'], policy)
      expect(flag(second.argv, '--temp')).toBe(tempDir)
      expect(flag(second.argv, '--writable-root')).toBe(member)
      expect(mockState.grants).toHaveLength(3)
    })
  })
})
