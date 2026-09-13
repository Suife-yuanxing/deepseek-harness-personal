# @deepseek-ai/dsh-secscan-policy

Egress secret-scan policy: a Cordis plugin that subscribes `agent/pre-step` and scans the text of
each newly submitted message batch before it leaves the machine toward a model API.

## Modes

| Mode | Behavior |
|---|---|
| `off` | Mounts nothing |
| `monitor` (default) | Record summarized findings to the local audit; never block or rewrite |

`redact` / `block` are rejected at load time until the P2 plan lands them. Engine failures fail
open in monitor (a broken engine must not break the loop) with a `scan-error` audit record.

## Audit

`<dsh home>/secscan/audit.jsonl`, ring-trimmed to the newest 1000 records. Records carry
ruleId/type/severity/last4 and never original secret text; auditing is best-effort and contained.

## Fingerprint source

The local credentials provider's `resolveAll()` (when it offers one) feeds exact-match
known-credential findings — the user's real keys, 100% precision. Values never leave the process
and are never persisted by this plugin.
