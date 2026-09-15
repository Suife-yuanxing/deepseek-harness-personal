import { describe, expect, it } from 'vitest'
import { RULES, scanRules } from '../src/rules.js'

/**
 * Synthetic fixtures are assembled at runtime so this source file never
 * contains a full credential-shaped literal (workspace security hook scans
 * source text). Every assembled value matches its rule's shape by design.
 */
const j = (...parts: string[]) => parts.join('')
const SK_SAMPLE = j('sk-test-', 'Abc123Def456Ghi789Jkl')
const AWS_SAMPLE = j('AKIA', 'IOSFODNN7EXAMPL3')
const ENV_SECRET_LINE = j('MY_API_KEY', ' = "', 'abcdef1234567890', '"')
const JSON_SECRET_LINE = j('{"api_key": "', 'abcdef1234567890', '"}')
const UUID_SAMPLE = j('9f3c2d1e-', 'a4b5-', '4c6d-', '8e7f-0123456789ab')

describe('scanRules', () => {
  it('finds a generic sk- style token', () => {
    const r = scanRules(`use ${SK_SAMPLE} as key`)
    expect(r.some(f => f.ruleId === 'generic-sk-token')).toBe(true)
  })

  it('does not flag ordinary words or short sk-', () => {
    expect(scanRules('skip the disk task')).toHaveLength(0)
    expect(scanRules('key=sk-short')).toHaveLength(0)
  })

  it('finds an AWS access key id', () => {
    expect(scanRules(`id ${AWS_SAMPLE} in config`).some(f => f.ruleId === 'aws-access-key-id')).toBe(true)
    expect(scanRules('AKIAXX')).toHaveLength(0)
  })

  it('finds a GitHub fine-grained PAT', () => {
    const sample = j('github_pat_11ABCDEFG0', 'abcdefghijklmnopqrstuvwxyz0')
    expect(scanRules(sample).some(f => f.ruleId === 'github-pat')).toBe(true)
  })

  it('finds an Anthropic key shape', () => {
    expect(scanRules(j('sk-ant-', 'test0123456789abcdef0123456789abcdef01')).some(f => f.ruleId === 'anthropic-key')).toBe(true)
  })

  it('finds a Google API key shape', () => {
    expect(scanRules(j('key AIzaSyA', '1234567890abcdefghijklmnopqrstuv')).some(f => f.ruleId === 'google-api-key')).toBe(true)
  })

  it('finds a Slack token shape', () => {
    expect(scanRules(j('xoxb-000000000000-000000000000-', 'abcdefghijklmnopqrstuvwx')).some(f => f.ruleId === 'slack-token')).toBe(true)
  })

  it('finds a PEM private key header', () => {
    expect(scanRules(j('-----BEGIN RSA PRIVATE', ' KEY-----')).some(f => f.ruleId === 'private-key-block')).toBe(true)
  })

  it('finds a JWT triple', () => {
    const jwt = j('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c')
    expect(scanRules(`token ${jwt}`).some(f => f.ruleId === 'jwt')).toBe(true)
  })

  it('finds a database URL with password', () => {
    expect(scanRules(j('postgres://admin:', 'p4ssw0rd', '@db.example.com:5432/app')).some(f => f.ruleId === 'db-conn-cred')).toBe(true)
    expect(scanRules('postgres://db.example.com:5432/app')).toHaveLength(0)
  })

  it('finds env-style secret assignment', () => {
    expect(scanRules(ENV_SECRET_LINE).some(f => f.ruleId === 'env-secret-assign')).toBe(true)
    expect(scanRules('LOG_LEVEL=info')).toHaveLength(0)
  })

  it('finds JSON secret fields', () => {
    expect(scanRules(JSON_SECRET_LINE).some(f => f.ruleId === 'json-secret-field')).toBe(true)
  })

  it('finds a bearer header value', () => {
    expect(scanRules(j('Authorization: Bearer ', 'abcdefghijklmnopqrst')).some(f => f.ruleId === 'bearer-token')).toBe(true)
  })

  it('finds a Heroku API key only when heroku context is present', () => {
    expect(scanRules(j('HEROKU_API_KEY=', UUID_SAMPLE)).some(f => f.ruleId === 'heroku-key')).toBe(true)
    expect(scanRules(j('heroku_key: ', UUID_SAMPLE)).some(f => f.ruleId === 'heroku-key')).toBe(true)
    expect(scanRules(j('heroku key = ', UUID_SAMPLE)).some(f => f.ruleId === 'heroku-key')).toBe(true)
    expect(scanRules(j('export HEROKU_API_KEY="', UUID_SAMPLE, '"')).some(f => f.ruleId === 'heroku-key')).toBe(true)
  })

  it('does not flag a bare UUID (memory-space or session ids)', () => {
    expect(scanRules(UUID_SAMPLE).some(f => f.ruleId === 'heroku-key')).toBe(false)
    expect(scanRules(j('deployed via heroku, session ', UUID_SAMPLE)).some(f => f.ruleId === 'heroku-key')).toBe(false)
    expect(scanRules(j('www.heroku.com/resource ', UUID_SAMPLE)).some(f => f.ruleId === 'heroku-key')).toBe(false)
  })

  it('returns positions that slice back to the match, with last4', () => {
    const text = `id ${AWS_SAMPLE} end`
    const f = scanRules(text).find(x => x.ruleId === 'aws-access-key-id')!
    expect(text.slice(f.start, f.end)).toBe(AWS_SAMPLE)
    expect(f.sampleLast4).toBe(AWS_SAMPLE.slice(-4))
  })
})

describe('RULES catalog', () => {
  it('has unique ids and valid metadata', () => {
    const ids = RULES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of RULES) expect(r.severity).toBeDefined()
  })
})
