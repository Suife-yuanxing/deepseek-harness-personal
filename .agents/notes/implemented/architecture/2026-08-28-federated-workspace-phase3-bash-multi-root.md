# Agent Note: Federated workspace phase 3 — bash multi-root on Windows ACL

Status: implemented

Date: 2026-08-28

## Problem

Phase 1 extended `writableRoots()` to merge `additionalRoots`, but only fs consumers read it: on Windows, a federated session's bash/pwsh child ran under a restricted token whose write capability listed ONLY the primary root's identity, so writes into member roots were denied while the same paths succeeded through the fs tools — the exact permission split the spec's risk register flagged.

## Decision

One identity per root end to end, threaded positionally:

1. **argv protocol** (runner): each additional member rides one repeatable `--writable-root <dir>` flag after `--workspace`. The primary keeps its legacy field name and its `--write-sid` pairing check — the protocol stays compatible for any existing argv builder. Both ends derive every workspace SID from its canonical path via the existing deterministic `workspaceWriteSid()`, so no additional SID flags travel on the wire. Validation fails loud at the runner boundary: non-existent or duplicate members exit 127, read-only rejects extra roots, and `assertTempRootOutsideWorkspace` now runs against EVERY member before anything spawns.
2. **restricted token** (`AclSandbox`): new positional pair — `additionalWriteSids` next to `writeSids[0] === writeSid`. Grants apply per directory under ITS identity (`grantWrite(writableDirs[i], writeSidPtrs[i])`), and `createRestrictedToken` receives all parsed pointers at once (the token layer already took an array). Constructor validation demands exactly one extra identity per extra directory, pairwise distinct from the primary and from siblings. The default-DACL choice (temp SID first) is unchanged.
3. **seam** (`LocalSandboxProvider`): the grant lifecycle splits along what actually varies — `materializeWorkspaceGrant(root)` stands one ACE per member root (the reuse cache, keyed by root as before), while `materializeSessionTemp(sessionId)` keys the revocable random temp by SESSION instead of session/workspace, because one federation shares a single private temp across all members. `windowsAclRunnerArgv` materializes every member, then emits one `--writable-root` per additional root between `--workspace` and `--temp`. Task 3.2 therefore required changes in this one seam method only — the bash consumers call `confine()` untouched.
4. **e2e**: `federated-roots.e2e.ts` gains the bash mirror of the fs matrix (member write lands through its own SID, outsider denied, relative anchors at the primary). The composition's bash executor always spawns `bash -c`, which does not exist on Windows, so that block self-skips on win32 where the equivalent acceptance runs for real inside sandbox-windows-acl's runner suite (a real WRITE_RESTRICTED token writing the member root through its derived SID).

## Alternatives considered

Sharing ONE capability SID across all member roots was rejected twice over: reusing the primary's SID would let any session that works on a single member enter sibling trees granted for other federations, breaking the per-path identity model that makes standing grants reusable across independent sessions; minting per-federation compound SIDs would multiply ACE propagation without adding isolation. A new `--<root>-sid` wire field per member was rejected because both ends already agree on the derivation function — passing derived values verbatim adds a tamper surface without information. Splitting the grant lifecycle by variance (root-standing vs session-temp) replaced the earlier [session, workspace] temp key precisely because a shared private temp belongs to the session, not to any member pair.

## Consequences

A federated session's confined child can now write every member root; outsiders and escapes stay denied exactly as before (unchanged negatives pinned). Each member's standing ACE joins the per-workspace reuse cache independently, so creating a federation never re-propagates trees whose roots were granted before. Verification lives in sandbox-windows-acl's constructor/init stub suite (pairing and distinctness contracts, three-grant happy pipeline), provider-chain argv assertions (one flag per member, order between `--workspace`/`--temp` preserved, both grants reused on the second confine), real-token runner probes for all three boundary refusals and the member-write acceptance, and the e2e block's POSIX lane.
