import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as SecscanPolicy from '../src/index.js'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempAudit(): string {
  const dir = mkdtempSync(join(tmpdir(), 'secscan-policy-'))
  dirs.push(dir)
  return join(dir, 'audit.jsonl')
}

async function harness(adapter: MockAdapter, credentials?: unknown): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  ;(ctx as unknown as { provide(key: string, value: unknown): void }).provide(
    'credentials',
    credentials ?? { resolveAll: async () => [] },
  )
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

const LEAKY = 'please store this sk-test-Abc123Def456Ghi789Jkl'

describe('secscan-policy (monitor)', () => {
  it('lets clean batches pass and writes no audit record', async () => {
    const file = tempAudit()
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    await ctx.plugin(SecscanPolicy, { mode: 'monitor', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('clean'), { provider: 'mock', model: 'mock' })
    send(agent, 'hello world')
    await waitForIdle(ctx, agent)
    expect(() => readFileSync(file)).toThrow()
  })

  it('records a summarized finding and passes the original text through unchanged', async () => {
    const file = tempAudit()
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    await ctx.plugin(SecscanPolicy, { mode: 'monitor', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('leaky'), { provider: 'mock', model: 'mock' })
    let reached = ''
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      const block = messages[0]?.content[0]
      if (block?.type === 'text' && block.text) reached = block.text
      return next()
    })
    send(agent, LEAKY)
    await waitForIdle(ctx, agent)
    expect(reached).toBe(LEAKY)
    const rec = JSON.parse(readFileSync(file, 'utf8').trim()) as {
      egress: string
      mode: string
      action: string
      findings: Array<{ ruleId: string; sampleLast4: string }>
    }
    expect(rec.egress).toBe('pre-step')
    expect(rec.mode).toBe('monitor')
    expect(rec.action).toBe('pass')
    expect(rec.findings.some(f => f.ruleId === 'generic-sk-token')).toBe(true)
    expect(JSON.stringify(rec)).not.toContain('sk-test-Abc123')
  })

  it('matches known credentials from the local provider as critical findings', async () => {
    const file = tempAudit()
    const ctx = await harness(new MockAdapter([textResponse('ok')]), {
      resolveAll: async () => [{ ref: 'DEEPSEEK_API_KEY', source: 'file', value: 'sk-test-000000000000000000000000' }],
    })
    await ctx.plugin(SecscanPolicy, { mode: 'monitor', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('fingerprinted'), { provider: 'mock', model: 'mock' })
    send(agent, 'the key is sk-test-000000000000000000000000 ok')
    await waitForIdle(ctx, agent)
    const rec = JSON.parse(readFileSync(file, 'utf8').trim()) as {
      findings: Array<{ ruleId: string; severity: string; source?: string }>
    }
    const known = rec.findings.find(f => f.ruleId === 'known-credential')
    expect(known?.severity).toBe('critical')
    expect(known?.source).toBe('DEEPSEEK_API_KEY(file)')
  })

  it('fails open on engine errors with a scan-error audit record', async () => {
    const file = tempAudit()
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    await ctx.plugin(SecscanPolicy, { mode: 'monitor', auditFile: file, failScan: true })
    const agent = ctx.agentLoop.create(SessionId('boom'), { provider: 'mock', model: 'mock' })
    send(agent, 'anything')
    await waitForIdle(ctx, agent)
    const rec = JSON.parse(readFileSync(file, 'utf8').trim()) as { kind: string; mode: string }
    expect(rec.kind).toBe('scan-error')
    expect(rec.mode).toBe('monitor')
  })
})

describe('secscan-policy (modes)', () => {
  it('mounts no listener in off mode', async () => {
    const file = tempAudit()
    const ctx = await harness(new MockAdapter([textResponse('ok')]))
    await ctx.plugin(SecscanPolicy, { mode: 'off', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('off'), { provider: 'mock', model: 'mock' })
    send(agent, LEAKY)
    await waitForIdle(ctx, agent)
    expect(() => readFileSync(file)).toThrow()
  })

  it('rejects an unknown mode at load time', async () => {
    const ctx = new Context()
    ;(ctx as unknown as { provide(key: string, value: unknown): void }).provide('credentials', {
      resolveAll: async () => [],
    })
    await expect(ctx.plugin(SecscanPolicy, { mode: 'yolo', auditFile: tempAudit() } as unknown as Record<string, unknown>)).rejects.toThrow(/yolo/)
  })
})

describe('secscan-policy (redact)', () => {
  /** Flattened text the model actually received (post pre-step decision). */
  function modelSeen(adapter: MockAdapter): string {
    return adapter.requests[0]!.messages
      .map(m => m.content.map(b => (b.type === 'text' ? b.text : '')).join(''))
      .join('\n')
  }

  it('enters the step with sensitive spans rewritten and records a redact action', async () => {
    const file = tempAudit()
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    await ctx.plugin(SecscanPolicy, { mode: 'redact', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('redact'), { provider: 'mock', model: 'mock' })
    send(agent, LEAKY)
    await waitForIdle(ctx, agent)
    const seen = modelSeen(adapter)
    expect(seen).not.toContain('sk-test-Abc123')
    expect(seen).toContain('⟨REDACTED:')
    expect(seen).toContain('…9Jkl⟩')
    const rec = JSON.parse(readFileSync(file, 'utf8').trim()) as { mode: string; action: string }
    expect(rec.mode).toBe('redact')
    expect(rec.action).toBe('redact')
  })

  it('passes info-only batches through untouched', async () => {
    const file = tempAudit()
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    await ctx.plugin(SecscanPolicy, { mode: 'redact', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('entropy-only'), { provider: 'mock', model: 'mock' })
    const HIGH_ENTROPY = 'qZ7Px2Km9Vb4Nc8Lf5Wd3' // 21 mixed chars: no rule match, above the entropy floor
    send(agent, `note ${HIGH_ENTROPY} done`)
    await waitForIdle(ctx, agent)
    expect(modelSeen(adapter)).toContain(`note ${HIGH_ENTROPY} done`)
    const rec = JSON.parse(readFileSync(file, 'utf8').trim()) as { action: string; findings: Array<{ severity: string }> }
    expect(rec.action).toBe('pass')
    expect(rec.findings.every(f => f.severity === 'info')).toBe(true)
  })

  it('fails open on engine errors with a scan-error record', async () => {
    const file = tempAudit()
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    await ctx.plugin(SecscanPolicy, { mode: 'redact', auditFile: file, failScan: true })
    const agent = ctx.agentLoop.create(SessionId('redact-boom'), { provider: 'mock', model: 'mock' })
    send(agent, LEAKY)
    await waitForIdle(ctx, agent)
    expect(modelSeen(adapter)).toContain(LEAKY)
    const rec = JSON.parse(readFileSync(file, 'utf8').trim()) as { kind: string }
    expect(rec.kind).toBe('scan-error')
  })
})
