# Agent Note: Federated workspace iteration — management UI, presence flags, and the missing createFederation gate

Status: implemented

Date: 2026-08-29

## Problem

The feature's code face was complete (phases 0–3) but the acceptance table's last mile was open. Driving the real deployment through it surfaced three gaps:

1. **`workspace.createFederation` had no gray-switch gate.** Spec §7 requires the switch to refuse BOTH creation doors — the `session.create` claim and `createFederation` — while leaving resolution ungated. Only the claim door was guarded (api-proxy session.create), so with the switch off a wire caller could still mint new federations. Package tests missed it because every createFederation test ran a harness that seeded through the same unguarded wire; the live OFF-state probe caught it (the refusal came back as `federation-name-conflict` — the request sailed past where `federation-disabled` belonged — instead of the gate error).
2. **Federations were unmanageable from the UI**: `renameFederation`/`deleteFederation` were wired end to end (wire → apiproxy → client manager) with zero consumers — a mistyped federation could only be fixed by editing `~/.dsh` storage by hand.
3. **A vanished member directory was silent**: the registry's tolerant missing-dir stance keeps rows forever, but nothing flagged them, so the first sign of a stale member was a session-create failure.

## Decision

1. **Gate** — one `federatedWorkspacesEnabled` check at the top of the `createFederation` handler answering `federation-disabled`, symmetric with the claim guard. The OFF-state regression test seeds its durable row through the registry directly (the gate sits above the registry, so "became durable while enabled, deployment later off" is the honest premise); the always-on suites now pass `federatedWorkspacesEnabled: true` explicitly.
2. **Management block** — the browser renders federation rows above the session tree when any exist: stacked-folders glyph, member tooltip (primary marked), ×N capsule, and a hover menu with rename (duplicate-checked against the federation title set) and delete (a confirmation dialog stating the non-destructive semantics: directories, workspaces, and session logs remain; existing federated sessions keep resolving — the delete closes on the unary answer while the row leaves on the baseline refresh, mirroring the manager's one-install-path convergence). The block is wide-only and gray-switch-independent: switch-off is exactly when leftover compositions need deleting.
3. **Presence flags** — the list handlers (`workspace.list`, `workspace.listFederations`) stat each workspace path / federation member and annotate rows with `missing` / `missingMembers`. Optional fields on the view types (`undefined` = "unknown", not "present") keep every fixture and double untouched; mutations that just validated their members omit the flags. Surfaces: the pick-menu row and browser row grow a `Missing` tag, the tooltip marks affected members, and the create panel locks flagged workspaces out of the member set with the reason inline.

## Alternatives considered

Gating inside the registry was rejected: the registry is the durable truth (its methods must work regardless of deployment policy, or seeding a durable row behind a later switch-off becomes impossible); the wire handler is where deployment policy lives. Pushing `missing` as a changed frame was rejected — presence is a point-in-time probe, not a durable fact, and a frame would imply a durable mutation; it rides the baseline it was probed for. A separate "federations" management surface outside the sidebar was rejected as chrome for chrome's sake: the rows are three affordances wide and the browser already owns the rename/delete dialog pattern.

## Consequences

With the switch off, both creation doors answer `federation-disabled` while `list/listFederations/rename/delete` and existing federated sessions keep working — the spec's rollback semantics now hold end to end and are pinned by an OFF-state wire test. Federations are fully manageable in the UI, and a stale member is visible at selection time instead of failing at claim time. Verified live on the local track (v0.5.2 shell): management block render, pick-menu rows/badges/tooltip, UI create → sidebar block echo, claim → chip ×2 + primary-group attribution + restart-restored header, cross-root fs and bash writes landing in the member root, OFF/ON toggle semantics, and tamper conflicts.
