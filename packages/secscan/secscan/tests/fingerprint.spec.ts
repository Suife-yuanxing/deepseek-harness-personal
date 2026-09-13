import { describe, expect, it } from 'vitest'
import { buildKnownCredentials, scanKnownCredentials } from '../src/fingerprint.js'

const VALUE = 'sk-test-000000000000000000000000'
const KNOWN = [
  { ref: 'DEEPSEEK_API_KEY', source: 'file', value: VALUE },
  { ref: 'DEEPSEEK_API_KEY', source: 'project-env', value: VALUE },
  { ref: 'SHORT', source: 'file', value: 'abc123' },
]

describe('buildKnownCredentials', () => {
  it('dedupes by value keeping the first (winning) source, drops values under 12 chars', () => {
    const built = buildKnownCredentials(KNOWN)
    expect(built).toHaveLength(1)
    expect(built[0]!.source).toBe('file')
  })
})

describe('scanKnownCredentials', () => {
  it('hits the exact substring with critical severity and a source label', () => {
    const text = `the key is ${VALUE} please`
    const f = scanKnownCredentials(text, buildKnownCredentials(KNOWN))
    expect(f).toHaveLength(1)
    expect(f[0]!.severity).toBe('critical')
    expect(f[0]!.type).toBe('known-credential')
    expect(f[0]!.source).toBe('DEEPSEEK_API_KEY(file)')
    expect(text.slice(f[0]!.start, f[0]!.end)).toBe(VALUE)
  })
  it('finds every occurrence', () => {
    expect(scanKnownCredentials(`${VALUE} and ${VALUE}`, buildKnownCredentials(KNOWN))).toHaveLength(2)
  })
  it('returns nothing for an empty known set or empty text', () => {
    expect(scanKnownCredentials('anything', [])).toHaveLength(0)
    expect(scanKnownCredentials('', buildKnownCredentials(KNOWN))).toHaveLength(0)
  })
})
