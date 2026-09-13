import { describe, expect, it } from 'vitest'
import * as engine from '../src/index.js'

describe('dsh-secscan package surface', () => {
  it('exposes the type module with no runtime members yet', () => {
    expect(Object.keys(engine).sort()).toEqual([])
  })
})
