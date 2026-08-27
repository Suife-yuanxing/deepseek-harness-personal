# Agent Note: Federated workspace phase 1 — core multi-root

Status: implemented

Date: 2026-08-28

## Problem

会话此前只能绑定一个可写目录（`SessionHeader.cwd`）。跨多个同级检出协作的用户要么被迫造一个人为父工作区，要么复制多个会话；Codex（`--add-dir`/writable roots）与 Claude Code（`additionalDirectories`）已收敛到多根会话，VS Code agentHost 则把有序根持久进会话身份并带恢复期冲突守卫。

## Decision

创建时不可变的 `SessionHeader.additionalRoots?: readonly string[]` 记录规范绝对路径（每个成员在创建时必须是已存在目录、彼此去重、不等于 cwd；空列表退化为缺席）。该字段作为一份完整契约贯穿整条持久链：存储侧校验与折叠、JSONL 首行序列化及形状守卫、SQLite 新列 `additional_roots`（`SCHEMA_VERSION` 15→16）、恢复期校验。可写访问仍经既有单一来源 `writableRoots()` 合并——主根在前、成员随其后、平台临时区殿后——fs 围栏、Seatbelt 与 bash 消费端无从漂移。面向提示词的上下文仅在存在成员时渲染钉死的多根句，否则逐字节保持前 federation 原句。`sessions.create` 经灰度开关 `ApiProxyService.Config.federatedWorkspacesEnabled`（默认 false）认领成员：关闭时任何携带该字段的请求在任何文件系统副作用之前回答 `federation-disabled`；开启后由一处显式 resolve 步骤校验成员资格（`federation-invalid-members`），并经 agent meta 通道把规范列表固化到 header。身份重试会在 cwd 比较之外追加「认领 versus 持久」清单比较并抛出同一冲突族（details 现在同时携带两份清单）；未携带该字段的请求按原样续用。

## Alternatives considered

事件折叠表示或 `SESSION_FORMAT_VERSION` bump 在预发布阶段要为读者毫无收益的机制付出重放代价；若未来出现结构性变更，bump 路线仍是文档化的兜底（[版本机制](2026-08-10-session-log-version-mechanism.md)）。为两种根形态渲染同一句话被否决：普通会话逐字节稳定的提示词前缀是缓存稳定性保证。在各后端各自实现而非收敛于 `writableRoots()` 会重新打开 sandbox 决策已经关死的 fs/bash 漂移；跨家族围栏笔记的 containment 立场不受本次影响。

## Consequences

既有日志无需迁移即可读取（phase-0 探测钉住加载器对未知成员的容忍度，支持落地后转为显式行为）；关闭开关只停止新联合会话，存量会话每次调用照常解析根。提示词字节仅在会话认领成员时变化。经由重试的外部篡改在持久日志与活体 agent 两条路径上都会被拒。验证落在 session/jsonl/sqlite 各套件、sandbox 单源 spec、`host/apiproxy` 测试（含 `federated-create.spec.ts`），以及 `packages/examples/agent-spine-demo/tests/federated-roots.e2e.ts`（相对路径→主根、绝对路径→成员、外部目录拒绝、句子渲染、普通会话字节兼容）。
