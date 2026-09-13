import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAudit } from '../src/audit.js'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'secscan-audit-'))
  dirs.push(dir)
  return join(dir, name)
}

describe('createAudit', () => {
  it('appends one json line per record with a timestamp and no original content', async () => {
    const file = tempFile('audit.jsonl')
    const audit = createAudit({ file })
    await audit.record({
      egress: 'pre-step', mode: 'monitor', action: 'pass',
      findings: [{ ruleId: 'generic-sk-token', type: 'sk-token', severity: 'high', sampleLast4: '9Jkl' }],
    })
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const rec = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(rec.egress).toBe('pre-step')
    expect(rec.mode).toBe('monitor')
    expect(rec.at).toBeTypeOf('number')
    expect(JSON.stringify(rec)).not.toContain('sk-test')
  })

  it('trims to the newest max records once headroom is exceeded', async () => {
    const file = tempFile('audit.jsonl')
    writeFileSync(file, `${Array.from({ length: 1201 }, (_, i) => JSON.stringify({ i })).join('\n')}\n`, 'utf8')
    const audit = createAudit({ file, max: 1000 })
    await audit.record({ i: 'new' })
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1000)
    expect(JSON.parse(lines[999]!)).toEqual({ at: expect.any(Number), i: 'new' })
    expect(JSON.parse(lines[0]!)).toEqual({ i: 202 })
  })

  it('does not trim while under headroom', async () => {
    const file = tempFile('audit.jsonl')
    writeFileSync(file, `${Array.from({ length: 1000 }, (_, i) => JSON.stringify({ i })).join('\n')}\n`, 'utf8')
    const audit = createAudit({ file, max: 1000 })
    await audit.record({ i: 'new' })
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1001)
  })

  it('contains every failure: an unwritable path resolves without throwing', async () => {
    const audit = createAudit({ file: join(tempFile('nope'), 'x', 'audit.jsonl'), max: 1000 })
    await expect(audit.record({ ok: true })).resolves.toBeUndefined()
  })
})
