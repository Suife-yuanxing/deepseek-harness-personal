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

/** Flattened text the model actually received (post pre-step decision). */
function modelSeen(adapter: MockAdapter): string {
  return adapter.requests[0]!.messages
    .map(m => m.content.map(b => (b.type === 'text' ? b.text : '')).join(''))
    .join('\n')
}

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

describe('secscan-policy (block)', () => {
  interface ApprovalProbe {
    toolName: string
    reason?: string
  }
  type Outcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

  function approvalStub(outcome: Outcome | 'throw'): { probe: ApprovalProbe[]; provide(): unknown } {
    const probe: ApprovalProbe[] = []
    return {
      probe,
      provide: () => ({
        request: async (req: ApprovalProbe): Promise<Outcome> => {
          probe.push(req)
          if (outcome === 'throw') throw new Error('injected approval failure')
          return outcome
        },
      }),
    }
  }

  async function blockHarness(outcome: Outcome | 'throw'): Promise<{ adapter: MockAdapter; probe: ApprovalProbe[]; file: string; sendLeaky(): Promise<void> }> {
    const stub = approvalStub(outcome)
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    ;(ctx as unknown as { provide(key: string, value: unknown): void }).provide('approval', stub.provide())
    const file = tempAudit()
    await ctx.plugin(SecscanPolicy, { mode: 'block', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('block'), { provider: 'mock', model: 'mock' })
    return {
      adapter,
      probe: stub.probe,
      file,
      sendLeaky: async () => {
        send(agent, LEAKY)
        await waitForIdle(ctx, agent)
      },
    }
  }

  it('asks with a synthetic tool name and rejects the turn when declined', async () => {
    const h = await blockHarness('rejected')
    await h.sendLeaky()
    expect(h.probe).toHaveLength(1)
    expect(h.probe[0]!.toolName).toBe('secscan')
    expect(h.probe[0]!.reason).toContain('…9Jkl')
    expect(h.probe[0]!.reason).not.toContain('sk-test-Abc123')
    expect(h.adapter.requests).toHaveLength(0) // the step never ran
    const rec = JSON.parse(readFileSync(h.file, 'utf8').trim()) as { mode: string; action: string }
    expect(rec.mode).toBe('block')
    expect(rec.action).toBe('blocked')
  })

  it('enters unredacted when allowed once', async () => {
    const h = await blockHarness('allowed-once')
    await h.sendLeaky()
    expect(h.probe).toHaveLength(1)
    expect(modelSeen(h.adapter)).toContain(LEAKY)
    const rec = JSON.parse(readFileSync(h.file, 'utf8').trim()) as { action: string }
    expect(rec.action).toBe('allowed')
  })

  it('fails closed when the approval ask throws', async () => {
    const h = await blockHarness('throw')
    await h.sendLeaky()
    expect(h.probe).toHaveLength(1)
    expect(h.adapter.requests).toHaveLength(0)
    const rec = JSON.parse(readFileSync(h.file, 'utf8').trim()) as { action: string }
    expect(rec.action).toBe('blocked')
  })

  it('fails closed when no approval service is composed', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const file = tempAudit()
    await ctx.plugin(SecscanPolicy, { mode: 'block', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('block-no-approval'), { provider: 'mock', model: 'mock' })
    send(agent, LEAKY)
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(0)
    const rec = JSON.parse(readFileSync(file, 'utf8').trim()) as { action: string }
    expect(rec.action).toBe('blocked')
  })
})

describe('secscan-policy (settings + event)', () => {
  /** Minimal settings provider: base-layer scopes with mutable values and watcher lists. */
  function provideSettings(ctx: Context): { registered: string[]; setField(field: string, value: unknown): void } {
    const registered: string[] = []
    const scopes = new Map<string, { value: Record<string, unknown>; watchers: Array<() => void> }>()
    ;(ctx as unknown as { provide(key: string, value: unknown): void }).provide('settings', {
      register: (ns: string, _schema: unknown, opts: { base?: Record<string, unknown> }) => {
        registered.push(ns)
        const scope = { value: { ...(opts?.base ?? {}) }, watchers: [] as Array<() => void> }
        scopes.set(ns, scope)
        return {
          get: () => scope.value,
          watch: (cb: () => void): void => { scope.watchers.push(cb) },
        }
      },
    })
    return {
      registered,
      setField: (field, value) => {
        for (const scope of scopes.values()) {
          scope.value[field] = value
          for (const w of scope.watchers) w()
        }
      },
    }
  }

  it('registers the secscan namespace and applies mode changes live', async () => {
    const adapter = new MockAdapter([textResponse('ok'), textResponse('ok')])
    const ctx = await harness(adapter)
    const settings = provideSettings(ctx)
    const file = tempAudit()
    await ctx.plugin(SecscanPolicy, { mode: 'monitor', auditFile: file })
    expect(settings.registered).toContain('secscan')
    const agent = ctx.agentLoop.create(SessionId('live-mode'), { provider: 'mock', model: 'mock' })
    send(agent, LEAKY) // monitor: passes
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
    settings.setField('mode', 'block') // the settings page writes the user layer
    send(agent, LEAKY) // now blocked
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(1)
    const recs = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { action?: string; kind?: string })
    expect(recs.some(r => r.action === 'pass')).toBe(true)
    expect(recs.some(r => r.action === 'blocked')).toBe(true)
  })

  it('emits secscan/findings with summarized findings only (no text)', async () => {
    const file = tempAudit()
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const emitted: Array<{ event: string; payload: unknown }> = []
    const origin = (ctx as unknown as { emit: (event: string, payload: unknown) => void }).emit.bind(ctx)
    ;(ctx as unknown as { emit: (event: string, payload: unknown) => void }).emit = (event, payload) => {
      emitted.push({ event, payload })
      origin(event, payload)
    }
    await ctx.plugin(SecscanPolicy, { mode: 'monitor', auditFile: file })
    const agent = ctx.agentLoop.create(SessionId('push'), { provider: 'mock', model: 'mock' })
    send(agent, LEAKY)
    await waitForIdle(ctx, agent)
    const hit = emitted.find(e => e.event === 'secscan/findings')
    expect(hit).toBeDefined()
    const payload = hit!.payload as { sessionId: string; mode: string; action: string; findings: Array<{ sampleLast4: string }> }
    expect(payload.sessionId).toBe(agent.id)
    expect(payload.mode).toBe('monitor')
    expect(payload.action).toBe('pass')
    expect(payload.findings.some(f => f.sampleLast4 === '9Jkl')).toBe(true)
    expect(JSON.stringify(payload)).not.toContain('sk-test-Abc123')
  })
})

describe('secscan-policy (command + tool)', () => {
  interface CommandDef {
    name: string
    handler: (inv: { rawInput: string }) => Promise<{ kind: string; text?: string }>
  }
  interface ToolDef {
    name: string
    execute: (args: { text: string }) => Promise<{ count: number; truncated: boolean; findings: Array<{ sampleLast4: string }> }>
  }

  async function registerHarness(): Promise<{ commands: CommandDef[]; tools: ToolDef[] }> {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const commands: CommandDef[] = []
    const tools: ToolDef[] = []
    ;(ctx as unknown as { provide(key: string, value: unknown): void }).provide('commands', {
      register: (def: CommandDef) => { commands.push(def) },
    })
    // The harness already mounts the real ToolRuntime: wrap its register so
    // definitions are captured AND author-validated by the real DSL.
    const runtime = ctx.get('tools') as unknown as { register: (def: ToolDef) => unknown }
    const origin = runtime.register.bind(runtime)
    runtime.register = (def: ToolDef) => { tools.push(def); return origin(def) }
    await ctx.plugin(SecscanPolicy, { mode: 'monitor', auditFile: tempAudit() })
    return { commands, tools }
  }

  it('registers the secrecy-scan command and the secscan_scan tool', async () => {
    const { commands, tools } = await registerHarness()
    expect(commands.map(c => c.name)).toEqual(['secrecy-scan'])
    expect(tools.map(t => t.name)).toEqual(['secscan_scan'])
  })

  it('secrecy-scan summarizes findings without echoing text', async () => {
    const { commands } = await registerHarness()
    const result = await commands[0]!.handler({ rawInput: `token ${LEAKY}` })
    expect(result.kind).toBe('success')
    expect(result.text).toContain('…9Jkl')
    expect(result.text).not.toContain('sk-test-Abc123')
  })

  it('secrecy-scan with empty input returns a usage error', async () => {
    const { commands } = await registerHarness()
    const result = await commands[0]!.handler({ rawInput: '   ' })
    expect(result.kind).toBe('error')
  })

  it('secscan_scan returns the canonical scan value', async () => {
    const { tools } = await registerHarness()
    const value = await tools[0]!.execute({ text: `token ${LEAKY}` })
    expect(value.count).toBeGreaterThan(0)
    expect(value.truncated).toBe(false)
    expect(value.findings.some(f => f.sampleLast4 === '9Jkl')).toBe(true)
    expect(JSON.stringify(value)).not.toContain('sk-test-Abc123')
  })
})
