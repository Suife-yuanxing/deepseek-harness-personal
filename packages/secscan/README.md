# secscan/ — artifact egress secret-scanning family

| Package | Role | ctx key |
|---|---|---|
| [`secscan/`](secscan/README.md) | Zero-dependency scan engine (rules / entropy / fingerprints / redaction) | library, no ctx |
| [`secscan-policy/`](secscan-policy/README.md) | Host egress policy plugin over `agent/pre-step` | registers listeners; writes local audit |

Design: `docs/superpowers/specs/2026-09-13-secscan-artifact-egress-design.md`（工作区仓 `docs/superpowers/specs/`）。
