# Agent Note: Federated workspace phase 1 — core multi-root

Status: implemented

Date: 2026-08-28

## Problem

Sessions could bind exactly one writable directory (`SessionHeader.cwd`). Users composing over several sibling checkouts needed either one artificial parent workspace or duplicated sessions, while Codex (`--add-dir` / writable roots) and Claude Code (`additionalDirectories`) had converged on multi-root sessions; VS Code's agentHost persisted ordered roots in session identity with a restore-time conflict guard.

## Decision

A creation-time-immutable `SessionHeader.additionalRoots?: readonly string[]` records canonical absolute directories (each an existing directory at create time, pairwise distinct, distinct from cwd; empty list degrades to absent). The field traverses the whole durability chain as one contract: store validation/fold, JSONL first-line serialization plus shape guard, a SQLite `additional_roots` column (`SCHEMA_VERSION` 15→16), and restore validation. Writable access merges through the existing single source `writableRoots()` — primary first, then members, then platform temp areas — so fs fencing, Seatbelt, and bash consumers cannot drift. The prompt-facing context renders a pinned multi-root sentence only when members exist and keeps the pre-federation sentence byte-identical otherwise. `sessions.create` claims members behind the gray switch `ApiProxyService.Config.federatedWorkspacesEnabled` (default false): disabled answers `federation-disabled` before any filesystem effect; enabled, one explicit resolve step validates membership (`federation-invalid-members`) and fixes the canonical list through the agent meta channel. Identity retries compare claimed versus durable lists beside the cwd comparison and raise the same conflict family, whose details now carry both lists; a request claiming no roots resumes unchanged.

## Alternatives considered

An event-fold representation or a `SESSION_FORMAT_VERSION` bump would have paid replay machinery for no reader benefit while pre-release; the bump route stays the documented fallback if a future structural change needs it ([version mechanism](2026-08-10-session-log-version-mechanism.md)). Rendering one shared sentence for both shapes was rejected because every ordinary session's byte-stable prompt prefix is a cache-stability guarantee. Enforcement inside individual backends instead of `writableRoots()` reopens the fs/bash drift the sandbox decision closed; the cross-family fence note's containment stance is unchanged by this work.

## Consequences

Existing logs stay readable without migration (the phase-0 probe pins loader tolerance for an unknown member, and support made it explicit); disabling the switch stops new federations while existing ones keep resolving roots on every call. Prompt bytes change only for sessions that claim members. Tampering through a retry is answered over persisted logs and live agents alike. Verification lives in the session/jsonl/sqlite suites, the sandbox single-source spec, `host/apiproxy` tests including `federated-create.spec.ts`, and `packages/examples/agent-spine-demo/tests/federated-roots.e2e.ts` (relative→primary, absolute→member, outsider denied, sentence rendering, ordinary byte-compatibility).
