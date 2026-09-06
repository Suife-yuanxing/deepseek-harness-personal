/**
 * workspace domain zod schemas (names derived from map keys). The
 * WorkspaceId brand cast lives in sessions.schema (see the note there) and
 * is re-exported here as the domain-local name.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { FederationView, WorkspaceView } from './workspace.ts'
import { sessionIdSchema, workspaceIdSchema, federationIdSchema } from './sessions.schema.ts'

export { workspaceIdSchema } from './sessions.schema.ts'
/** FederationId cast is hosted in sessions.schema (DAG note there); re-exported as the domain-local name. */
export { federationIdSchema } from './sessions.schema.ts'

/** FederationView row of every federation.* response. */
export const federationViewSchema = z.object({
  federationId: federationIdSchema,
  title: z.string(),
  memberPaths: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  // List-handler presence probe only; mutations that just validated their
  // members omit it.
  missingMembers: z.array(z.string()).optional(),
}) satisfies z.ZodType<Wire<FederationView>>

/** WorkspaceView row of every workspace.* response. */
export const workspaceViewSchema = z.object({
  workspaceId: workspaceIdSchema,
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(sessionIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  // List-handler presence probe only; mutations that just validated the path omit it.
  missing: z.boolean().optional(),
}) satisfies z.ZodType<Wire<WorkspaceView>>

/** workspace.list request payload (empty object literal). */
export const workspaceListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.list'>>>

/** workspace.list response value. */
export const workspaceListValueSchema = z.object({
  items: z.array(workspaceViewSchema),
  archivedSessionIds: z.array(sessionIdSchema),
  federations: z.array(federationViewSchema),
  federatedWorkspacesEnabled: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.list'>>>

/** workspace.create request payload: the existing directory to adopt. */
export const workspaceCreateRequestSchema = z.object({
  path: z.string(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.create'>>>

/** workspace.create response value. */
export const workspaceCreateValueSchema = z.object({
  workspace: workspaceViewSchema,
  created: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.create'>>>

/** workspace.rename request payload: the new title must be non-blank. */
export const workspaceRenameRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.rename requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.rename'>>>

/** workspace.rename response value. */
export const workspaceRenameValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.rename'>>>

/** workspace.delete request payload. */
export const workspaceDeleteRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.delete'>>>

/** workspace.delete response value. */
export const workspaceDeleteValueSchema = z.object({
  deleted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.delete'>>>

/** workspace.insertBefore request payload (anchor omitted = append to end). */
export const workspaceInsertBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  beforeWorkspaceId: workspaceIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertBefore'>>>

/** workspace.insertBefore response value: the complete durable display order. */
export const workspaceInsertBeforeValueSchema = z.object({
  workspaceIds: z.array(workspaceIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertBefore'>>>

/** workspace.insertSessionBefore request payload (anchor omitted = append to end). */
export const workspaceInsertSessionBeforeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
  beforeSessionId: sessionIdSchema.optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.insertSessionBefore'>>>

/** workspace.insertSessionBefore response value. */
export const workspaceInsertSessionBeforeValueSchema = z.object({
  workspace: workspaceViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.insertSessionBefore'>>>

/** workspace.archiveSession request payload. */
export const workspaceArchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.archiveSession'>>>

/** workspace.archiveSession response value: the full updated archive set. */
export const workspaceArchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.archiveSession'>>>

/** workspace.unarchiveSession request payload. */
export const workspaceUnarchiveSessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.unarchiveSession'>>>

/** workspace.unarchiveSession response value: the full updated archive set. */
export const workspaceUnarchiveSessionValueSchema = z.object({
  archivedSessionIds: z.array(sessionIdSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.unarchiveSession'>>>

/** workspace.createFederation request payload (title omitted = joined basenames). */
export const workspaceCreateFederationRequestSchema = z.object({
  title: z.string().optional(),
  memberPaths: z.array(z.string().min(1)).min(2).max(16),
}).refine(
  payload => payload.title === undefined || payload.title.trim() !== '',
  { message: 'federation title must be a non-blank string' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.createFederation'>>>

/** workspace.createFederation response value. */
export const workspaceCreateFederationValueSchema = z.object({
  federation: federationViewSchema,
  created: z.boolean(),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.createFederation'>>>

/** workspace.listFederations request payload (empty object literal). */
export const workspaceListFederationsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'workspace.listFederations'>>>

/** workspace.listFederations response value. */
export const workspaceListFederationsValueSchema = z.object({
  items: z.array(federationViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.listFederations'>>>

/** workspace.renameFederation request payload (same title rules, schema-enforced non-blank). */
export const workspaceRenameFederationRequestSchema = z.object({
  federationId: federationIdSchema,
  title: z.string(),
}).refine(
  payload => payload.title.trim() !== '',
  { message: 'workspace.renameFederation requires a non-blank title' },
) satisfies z.ZodType<Wire<RequestPayload<'workspace.renameFederation'>>>

/** workspace.renameFederation response value. */
export const workspaceRenameFederationValueSchema = z.object({
  federation: federationViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.renameFederation'>>>

/** workspace.deleteFederation request payload. */
export const workspaceDeleteFederationRequestSchema = z.object({
  federationId: federationIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workspace.deleteFederation'>>>

/** workspace.deleteFederation response value (unknown id is an idempotent success). */
export const workspaceDeleteFederationValueSchema = z.object({
  deleted: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'workspace.deleteFederation'>>>
