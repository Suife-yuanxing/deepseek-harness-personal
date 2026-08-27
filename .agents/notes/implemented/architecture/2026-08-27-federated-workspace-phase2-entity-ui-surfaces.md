# Agent Note: Federated workspace phase 2 — entity UI surfaces

Status: implemented

Date: 2026-08-28

## Problem

After phase 1 the full backend capability existed — durable federation records, wire methods, the `sessions.create` claim path, gray-switch gating — but no user surface could create a federation, start a session from one, or see a session's multi-root identity anywhere in the browser.

## Decision

Affordances ride three existing channels with zero new framework extension points:

1. **Pick menu (entry + badge).** `workspace.list` now carries the durable `federations` rows *and* the deployment's gray switch (`federatedWorkspacesEnabled`) so the pick flow reads both from the same `useWorkspaces` selector snapshot it already subscribes to — no second subscription channel, no config mirror (micro-decision 2). Rows render after regular workspaces; the stacked-folders glyph is two offset `currentColor` rounded rectangles drawn inline, and the count capsule (`×N`) plus the hover member tooltip ride the same `MenuEntry.label` ReactNode cell. Micro-decision 5's fallback (label suffix) never activated because `label` and `icon` both accept JSX.
2. **Claim flow (no object-layer knowledge).** Picking a row calls an injected carrier that runs `workspaces.startFederatedSession(federationId)` and opens the returned id; creating happens through the create panel calling `createFederation`. Both are plain callbacks from the apply closure (micro-decision 3's final shape: the Host resolves primary cwd, member roots, and attach — the earlier plan's client-side `slice(1)` verb chain was replaced by the 2.2b server-side claim). A failed claim reuses the shared error dialog under a federation-specific heading. The sidebar browser carries the same completion but keeps its add-only posture (no federation rows) because its gesture is registration, not session creation.
3. **Create panel.** A Modal inside ui-workspace lists registered workspaces as `role="checkbox"` toggle rows (check order fixes membership), each checked row offering a promote-to-primary ghost button (moves it to index 0, others keep relative order). The title defaults to basenames joined with `' + '` recomputed on membership change until the user types (touched flag stops following); below two members the confirm stays disabled beside the localized hint; business failures render inline as an alert while the panel stays open for retry. Panel state is instance-local useState — raising remounts, so no cross-panel store exists (rule 5 of the props ladder).
4. **In-session chip.** `SessionSummary.additionalRoots` reaches every summary path through one projection function (`sessionListFields`: cold rows, attached rows, and the `session-added` frame), mirroring the header passthrough without new frames (micro-decision 6). `FederatedRootsChip` occupies the pre-existing `'conversation.input.dock'` list seat at `order: 30` (nearest the composer card) and renders from the global `useSessions` current-row selector; ordinary or cwd-less sessions render nothing — the regression red line is asserted by component specs over DOM absence, not just visual review.

One style consequence worth recording: the panel's member list uses `--dsw-alias-bg-layer-2`, which places the sheet on the scrollbar guard's elevated rung; the guard caught the missing rebinding at review time and `.memberList` rebinds the l2 thumb/hover pair per the scrollbar contract — first real catch by the palette-ladder derivation since its note.

## Alternatives considered

Threading federation data as picker owner props would have widened two owner contracts (hero and add-only sidebar) and duplicated a subscription the runtime already maintains; reading the state through the existing hook keeps the seam smaller than either alternative. Extending the shared `MenuEntry` primitive with a trailing-metadata field would have moved a feature concern into `ui-primitives`; the `label` ReactNode already satisfies the pill-with-icon visual, so the primitive stayed untouched. Parking the chip on a conversation-owned store or a new dedicated slot lost to the existing dock seat: the data is already global, the placement matches the queue/todo strip family, and slots.inject keeps HMR rollback symmetric.

## Consequences

A disabled deployment renders byte-for-byte as before (the enabled bit hides every row and action), satisfying acceptance item 6's UI half; enabling adds federation rows, the New-federation action, and the chip. With the switch on and no directory-flow occupant, a sole create-federation entry shows a one-row menu instead of the previous empty popover — an intentional visible change gated behind the switch. Verification lives in `packages/client/ui-workspace/tests/` (menu ordering/badges/tooltip/gray gate/claim/create flows; panel disable-promote-title-inline-error cases), `packages/client/ui-conversation/tests/federated-roots-chip.client.spec.tsx` (marker, ordinary-session null, tooltip line builder), plus the apiproxy summary/frame passthrough tests, and `DSH_SNAPSHOT=replay pnpm run test:web` confirming unchanged assembled output on the default deployment.
