import { describe, expect, it } from 'vitest'
import * as engine from '../src/index.js'

describe('dsh-secscan package surface', () => {
  it('exposes the full engine API', () => {
    expect(Object.keys(engine).sort()).toEqual([
      'RULES',
      'buildKnownCredentials',
      'redactText',
      'scan',
      'scanEntropy',
      'scanKnownCredentials',
      'scanRules',
      'shannonEntropy',
    ])
  })
})
