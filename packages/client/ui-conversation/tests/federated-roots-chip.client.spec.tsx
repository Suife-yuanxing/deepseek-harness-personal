// @vitest-environment jsdom
/**
 * Federated-roots chip acceptance: a federated session renders the stacked
 * marker with its member count; an ordinary single-root session renders
 * nothing at all (the regression red line); the tooltip member list is pinned
 * through the pure line builder.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { FederatedRootsChipProps } from '../src/client/input/FederatedRootsChip.tsx'
import { FederatedRootsChip, federatedRootsLines } from '../src/client/input/FederatedRootsChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is conversation ∪ common; the stub mirrors the real
// lookup chain.
const t: FederatedRootsChipProps['t'] = makeTranslate(zh, commonZh)

const sid = 's-fed' as never

function summary(row: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 's' as never, updatedAt: 0, running: false, blank: false,
    ...row,
  } as SessionSummary
}

const baseState: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready',
  subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
} as unknown as SessionListState

function mount(state: SessionListState): void {
  const useSessions = function select<S>(selector: (list: SessionListState) => S): S { return selector(state) }
  // Dock entries receive the full four-share currency; the chip reads only
  // the global seat and locale, so inert stubs satisfy the rest.
  render(
    <FederatedRootsChip
      useSessions={useSessions}
      t={t}
      useSession={(() => undefined) as never}
      sessionId={'s-fed' as never}
      useProjection={(() => () => undefined) as never}
      useInput={(() => undefined) as never}
      inputActions={{} as never}
      useWorkspaces={(function select<S>(selector: (list: never) => S): S { return selector(undefined as never) }) as never}
      session={{} as never}
      input={{} as never}
    />,
  )
}

describe('FederatedRootsChip', () => {
  it('renders the stacked-folders marker with the member count for a federated session', () => {
    mount({
      ...baseState,
      current: sid,
      byId: { [sid]: summary({ cwd: '/work/main', additionalRoots: ['/work/b', '/work/c'] }) },
    })
    // cwd + two extra roots = three members on the capsule.
    expect(screen.getByText('×3')).toBeTruthy()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('renders nothing for an ordinary single-root session', () => {
    mount({ ...baseState, current: sid, byId: { [sid]: summary({ cwd: '/work/main' }) } })
    expect(screen.queryByText(/×/)).toBeNull()
    expect(document.querySelector('svg')).toBeNull()
  })

  it('renders nothing while no session is current', () => {
    mount(baseState)
    expect(document.querySelector('svg')).toBeNull()
  })

  it('pins the tooltip member list through the pure line builder', () => {
    // Primary first and marked; basenames only (Windows separators included).
    expect(federatedRootsLines('/work/main', ['/work/extra', 'D:\\side\\proj'], '主'))
      .toBe('主 main\nextra\nproj')
    // A row without a recorded cwd drops the marked line instead of lying.
    expect(federatedRootsLines(undefined, ['/work/extra'], '主')).toBe('extra')
  })
})
