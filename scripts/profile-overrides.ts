/**
 * profile junction 覆盖表:link-profile-overrides.ts(建链)与
 * check-upstream-compat.ts(上游适配体检)共用。
 *
 * 包名 → 仓库内相对路径(lib/ 由 build:lib 产出)。
 * 修改覆盖集合时只改这张表。
 */
export const OVERRIDES: Readonly<Record<string, string>> = {
  '@deepseek-ai/dsh-client-ui-conversation': 'packages/client/ui-conversation',
  '@deepseek-ai/dsh-client-ui-workspace': 'packages/client/ui-workspace',
  '@deepseek-ai/dsh-session-log-export': 'packages/session-query/session-log-export',
}
