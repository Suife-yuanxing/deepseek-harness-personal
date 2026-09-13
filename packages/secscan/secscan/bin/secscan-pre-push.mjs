#!/usr/bin/env node
/**
 * git pre-push hook: scan outgoing commits for secrets before they leave the
 * machine. git invokes the hook with one `<local ref> <local sha> <remote ref>
 * <remote sha>` line per pushed ref on stdin; every non-deletion update is
 * scanned as one diff. Findings print with rule/type/tail-4 only — never the
 * matched text — and abort the push with exit code 1.
 *
 * Install for one repository (adjust the absolute path):
 *   node -e "require('fs').writeFileSync('.git/hooks/pre-push',
 *     '#!/bin/sh\nexec node \'<abs path>/packages/secscan/secscan/bin/secscan-pre-push.mjs\'\n')"
 *   chmod +x .git/hooks/pre-push   (git for windows ships sh)
 */
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { scan } from '../lib/index.js'

const ZEROS = /^0+$/

let findings = 0
const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 4) continue
  const localSha = parts[1]
  const remoteSha = parts[3]
  if (localSha === undefined || ZEROS.test(localSha) || ZEROS.test(remoteSha)) continue
  const diff = execFileSync('git', ['diff', '--no-color', `${remoteSha}..${localSha}`], {
    maxBuffer: 1 << 26,
  }).toString()
  const report = scan({ kind: 'text', content: diff })
  for (const f of report.findings) {
    findings += 1
    console.error(`secscan: ${f.ruleId} ${f.type} …${f.sampleLast4}`)
  }
}
if (findings > 0) {
  console.error(`secscan: ${findings} finding(s); push aborted`)
  process.exit(1)
}
