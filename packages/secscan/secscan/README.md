# @deepseek-ai/dsh-secscan

Zero-dependency secret-scanning engine. Pure library: no I/O, no cordis — callers own input
acquisition and action on reports. Reports never carry original matched text, only spans and a
4-char tail for correlation.

## Surface

| Export | Role |
|---|---|
| `scan(input, options)` | Full entry: ceiling-truncate, run all passes, merge, time it |
| `RULES` / `scanRules` | Curated high-confidence regex rules (self-authored) |
| `scanEntropy` | Token-shaped high-entropy runs; findings are always `info` |
| `buildKnownCredentials` / `scanKnownCredentials` | Exact substring match of the user's real credential values (`critical`) |
| `redactText` | Replace finding spans with `⟨REDACTED:<type>:…<last4>⟩` placeholders |

Overlap semantics: the report keeps every rule view and drops only exact duplicates; overlap is
resolved where it matters, at action time (redaction keeps the higher severity).

Design: the artifact egress secret-scanning spec in the workspace repo
(`docs/superpowers/specs/2026-09-13-secscan-artifact-egress-design.md`).
