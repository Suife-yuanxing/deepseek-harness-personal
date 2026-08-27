/**
 * The workspace domain declaration: record schema and the `defineDomain` spec
 * the registry opens. The zod schema is the durable-boundary validator today
 * and the direct source of the RPC wire projection in a later phase.
 * @module @deepseek-ai/dsh-workspace/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FederationId, WorkspaceId } from './types.ts'

/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceId = z.string().transform(value => value as WorkspaceId)

/** Federation id schema at the durable boundary; branding has no runtime representation. */
const federationId = z.string().transform(value => value as FederationId)

/**
 * Durable shape of one workspace record. `path` is the `fs.realpath` canon
 * stamped at create; `sessionIds` is the ordered ownership account (array
 * order is display order); timestamps are ISO-8601 strings.
 */
export const workspaceRecord = z.object({
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(z.string().transform(SessionId)),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored workspace record, inferred from {@link workspaceRecord}. */
export type WorkspaceRecord = z.infer<typeof workspaceRecord>

/**
 * Durable shape of one federation record. `memberPaths` are canonical
 * directories, order = creation choice with `[0]` the primary root; the
 * record is immutable after create except title/updatedAt through rename.
 * Timestamps are ISO-8601 strings like {@link workspaceRecord}.
 */
export const federationRecord = z.object({
  title: z.string(),
  memberPaths: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored federation record, inferred from {@link federationRecord}. */
export type FederationRecord = z.infer<typeof federationRecord>

/**
 * Recoverable two-write mutation marker. The marker is persisted before the
 * record/order pair can diverge, so startup can distinguish an interrupted
 * registry operation from unexplained medium corruption.
 */
const workspacePendingMutation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create'), workspaceId }),
  z.object({ operation: z.literal('delete'), workspaceId }),
])

/**
 * Durable registry state. `initialized` distinguishes a valid empty registry
 * from one that still needs the header-only history bootstrap;
 * `workspaceIds` is the authoritative display order. `archivedSessionIds` is
 * the registry-global archive set layered over workspace accounting: an
 * archived session keeps its `sessionIds` slot (unarchiving must restore the
 * position), so the set never participates in the one-owner accounting
 * invariant. Defaulted so records written before the field parse unchanged.
 */
export const workspaceDomainState = z.object({
  initialized: z.boolean(),
  workspaceIds: z.array(workspaceId),
  archivedSessionIds: z.array(z.string().transform(SessionId)).default([]),
  /** Durable federation display order (creation order; v1 has no reorder). Defaulted for pre-federation media. */
  federationIds: z.array(federationId).default([]),
  pendingMutation: workspacePendingMutation.optional(),
})

/** Durable registry state inferred from {@link workspaceDomainState}. */
export type WorkspaceDomainState = z.infer<typeof workspaceDomainState>

/**
 * The workspace domain spec: one `workspaces` table keyed by
 * {@link WorkspaceId} plus the bootstrap/order singleton. The registry opens
 * this through `ctx.storage.domain`; the spec object is the single source of
 * the domain's identity, version, and schemas.
 */
export const workspaceDomainSpec = defineDomain({
  name: 'workspace',
  // Stays 2: the federation table + defaulted order field are ADDITIVE —
  // pre-federation media upgrade through the schema default and the missing
  // medium table reads as empty, so bumping the per-unit stamp would reject
  // every existing registry for no reader benefit.
  version: 2,
  global: {
    schema: workspaceDomainState,
    initial: { initialized: false, workspaceIds: [], archivedSessionIds: [], federationIds: [] },
  },
  tables: {
    workspaces: domainTable<WorkspaceId, WorkspaceRecord>(workspaceRecord),
    federations: domainTable<FederationId, FederationRecord>(federationRecord),
  },
})
