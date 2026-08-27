/**
 * Tests for the writable-root derivation: the mode's meaning as a canonical
 * allow-list. Pinned here so the fs fence and the Seatbelt profile — both
 * deriving from `writableRoots` — cannot drift.
 */

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'

describe('canonicalPath', () => {
  it('resolves symlinks (an existing path realpaths)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-roots-'))
    expect(canonicalPath(dir)).toBe(realpathSync.native(dir))
  })

  it('returns the spelling as-is when the path cannot be resolved (conservative — matches nothing until it exists)', () => {
    expect(canonicalPath('/does/not/exist/anywhere-xyz')).toBe('/does/not/exist/anywhere-xyz')
  })
})

describe('writableRoots', () => {
  it('read-only grants nothing', () => {
    expect(writableRoots({ mode: 'read-only', workspaceRoot: process.cwd() })).toEqual([])
  })

  it('workspace-write grants the workspace root plus the platform temp areas, canonical and deduplicated', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    const roots = writableRoots({ mode: 'workspace-write', workspaceRoot: ws })
    expect(roots).toContain(realpathSync.native(ws))
    expect(roots).toContain(canonicalPath('/tmp'))
    expect(roots).toContain(realpathSync.native(tmpdir()))
    // Deduplicated after canonicalization (/tmp and os.tmpdir() may coincide).
    expect(new Set(roots).size).toBe(roots.length)
  })

  it('workspace-write grants additional roots after the primary and before temp areas', () => {
    const wsA = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-fed-a-')))
    const wsB = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-fed-b-')))
    const roots = writableRoots({
      mode: 'workspace-write',
      workspaceRoot: wsA,
      additionalRoots: [wsB],
    })
    // The primary root stays first; named roots follow in order.
    expect(roots[0]).toBe(wsA)
    expect(roots[1]).toBe(wsB)
    expect(roots).toContain(canonicalPath('/tmp'))
    expect(roots).toContain(realpathSync.native(tmpdir()))
    expect(new Set(roots).size).toBe(roots.length)
  })

  it('canonicalizes and deduplicates an alias spelling of a named root', () => {
    const raw = mkdtempSync(join(tmpdir(), 'dsh-fed-alias-'))
    const canonical = realpathSync.native(raw)
    const roots = writableRoots({
      mode: 'workspace-write',
      workspaceRoot: canonical,
      // A symlinked or case-aliased spelling of the same directory must not
      // mint a second grant.
      additionalRoots: [raw],
    })
    expect(roots.filter(root => root === canonical)).toHaveLength(1)
  })

  it('treats an absent or empty additionalRoots as the ordinary single-root policy', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-single-'))
    const baseline = writableRoots({ mode: 'workspace-write', workspaceRoot: ws })
    expect(writableRoots({ mode: 'workspace-write', workspaceRoot: ws, additionalRoots: [] }))
      .toEqual(baseline)
    // exactOptionalPropertyTypes: "absent" is spelled by omitting the key.
    expect(writableRoots({ mode: 'workspace-write', workspaceRoot: ws }))
      .toEqual(baseline)
  })
})
