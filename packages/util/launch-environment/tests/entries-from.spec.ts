import { describe, expect, it } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '../src/index.ts'

describe('entriesFrom', () => {
  it('enumerates requested layers with the most trusted layer winning per name', () => {
    const snap = createLaunchEnvironmentSnapshot([
      { source: 'user-env', path: '/home/.env', values: { ALPHA: 'from-user', BETA: 'user-beta' } },
      { source: 'project-env', path: '/proj/.env', values: { ALPHA: 'from-project' } },
    ])
    expect(snap.entriesFrom(['project-env', 'user-env'])).toEqual([
      { name: 'ALPHA', value: 'from-project', source: 'project-env', path: '/proj/.env' },
      { name: 'BETA', value: 'user-beta', source: 'user-env', path: '/home/.env' },
    ])
  })

  it('omits unrequested layers entirely', () => {
    const snap = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { ALPHA: 'from-process' } },
      { source: 'user-env', values: { BETA: 'from-user' } },
    ])
    expect(snap.entriesFrom(['user-env'])).toEqual([{ name: 'BETA', value: 'from-user', source: 'user-env' }])
  })

  it('returns an empty array when no requested layer supplies anything', () => {
    expect(createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]).entriesFrom(['project-env'])).toEqual([])
  })
})
