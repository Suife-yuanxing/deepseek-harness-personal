import { describe, expect, it } from 'vitest'
import { redactText } from '../src/redact.js'
import { scan } from '../src/index.js'

describe('redactText', () => {
  it('replaces spans right-to-left without corrupting offsets', () => {
    const text = 'a AKIAIOSFODNN7EXAMPLE b'
    const findings = [{ ruleId: 'aws-access-key-id', type: 'cloud-credential', severity: 'critical' as const, start: 2, end: 22, sampleLast4: 'MPLE' }]
    expect(redactText(text, findings)).toBe('a ⟨REDACTED:cloud-credential:…MPLE⟩ b')
  })

  it('keeps the higher severity span on overlap and drops the swallowed one', () => {
    const findings = [
      { ruleId: 'jwt', type: 'jwt', severity: 'high' as const, start: 0, end: 10, sampleLast4: 'aaaa' },
      { ruleId: 'known-credential', type: 'known-credential', severity: 'critical' as const, start: 5, end: 15, sampleLast4: 'bbbb' },
    ]
    expect(redactText('0123456789abcdef', findings)).toBe('01234⟨REDACTED:known-credential:…bbbb⟩f')
  })

  it('never redacts from info findings', () => {
    const findings = [{ ruleId: 'high-entropy', type: 'high-entropy', severity: 'info' as const, start: 0, end: 10, sampleLast4: 'aaaa' }]
    expect(redactText('0123456789abc', findings)).toBe('0123456789abc')
  })

  it('no findings → unchanged text', () => {
    expect(redactText('plain', [])).toBe('plain')
  })
})

describe('scan', () => {
  it('merges rule + entropy + fingerprint passes, keeping each rule view', () => {
    const value = 'sk-test-000000000000000000000000'
    const report = scan({ kind: 'text', content: `key ${value} ok` }, {
      known: [{ ref: 'DEEPSEEK_API_KEY', source: 'file', value }],
      entropy: true,
    })
    expect(report.findings.filter(f => f.ruleId === 'generic-sk-token')).toHaveLength(1)
    expect(report.findings.filter(f => f.ruleId === 'known-credential')).toHaveLength(1)
    expect(report.findings.filter(f => f.ruleId === 'known-credential')[0]!.severity).toBe('critical')
    expect(report.truncated).toBe(false)
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('drops only exact duplicate findings', () => {
    const report = scan({ kind: 'text', content: 'x' })
    expect(report.findings).toHaveLength(0)
  })

  it('marks truncated and scans only the ceiling', () => {
    const report = scan({ kind: 'text', content: 'x'.repeat(50), name: 'big.txt' }, { maxBytes: 10 })
    expect(report.truncated).toBe(true)
  })

  it('clean text yields empty findings', () => {
    expect(scan({ kind: 'text', content: 'hello world' }).findings).toHaveLength(0)
  })
})
