import { describe, expect, it } from 'vitest'
import { scanEntropy, shannonEntropy } from '../src/entropy.js'

describe('shannonEntropy', () => {
  it('is 0 for a single repeated char', () => {
    expect(shannonEntropy('aaaaaaaaaaaaaaaaaaaa')).toBe(0)
  })
  it('is higher for mixed-case alternation than for two repeated chars', () => {
    expect(shannonEntropy('AaBbCcDdEeFfGgHhIiJj')).toBeGreaterThan(shannonEntropy('aaaaaaaaaabbbbbbbbbb'))
  })
})

describe('scanEntropy', () => {
  it('flags a long high-entropy token as info', () => {
    const f = scanEntropy('blob Xk9mQ2vB8nZ7pL4wJ6hT3yR5uA1c end')
    expect(f).toHaveLength(1)
    expect(f[0]!.severity).toBe('info')
    expect(f[0]!.type).toBe('high-entropy')
  })
  it('does not flag prose without token-shaped runs', () => {
    expect(scanEntropy('this is just ordinary prose with words')).toHaveLength(0)
    expect(scanEntropy('short xk9!mQ2')).toHaveLength(0)
  })
  it('does not flag low-entropy repeated runs', () => {
    expect(scanEntropy('aaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb')).toHaveLength(0)
  })
})
