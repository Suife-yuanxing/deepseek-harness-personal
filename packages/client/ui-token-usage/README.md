---
description: "为设置里的 Token 用量页面提供人民币计费展示、内置 Token Plan 套餐目录与标准/套餐双模式计费引擎。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-token-usage

Token usage settings plugin: the settings section that bills model calls in CNY and supports billing through a prepaid Token Plan.

## 概述

本插件在“设置”中注册 **Token 用量** 页面。页面统一以人民币展示所有费用；计费引擎（纯函数，见 `src/billing.ts`）支持两种模式：

- **标准计费**：按 DeepSeek 官方刊例单价（人民币 / 百万 tokens，区分缓存命中输入、未命中输入与输出，空闲 / 高峰双价）计算本次调用的费用。
- **套餐计费（Token Plan）**：识别用户绑定的 Token Plan 套餐，从月度额度（tokens 或积分）中扣减本次消耗；额度不足时按套餐的超额规则计费，页面展示套餐剩余额度、已用额度、本次消耗与对应人民币费用。

套餐目录内置在 `BUILTIN_TOKEN_PLANS`（同时导出 `tokenPlanById`），价格来源与维护方式见该常量的 JSDoc；增改套餐只需增改目录条目。生效模式与额度记账持久化在 `ui-token-usage` 设置命名空间（Host 侧 `settings.register`，浏览器侧 `settingsScope.bind`）。

### 何时选择

当部署需要在 DSH 设置页为用户展示人民币计费、或按 Token Plan 套餐核算模型调用费用时选择本插件。页面内置“模拟一次模型调用”表单：输入模型与各 token 桶后按当前生效模式计算并记账，可用于验收不同绑定下的计费结果。

### 使用本包

```yaml
- name: '@deepseek-ai/dsh-client-ui-token-usage'
```

套餐目录与计费引擎也可以脱离 UI 使用：

```ts
import { consumePlan, standardCostCny, tokenPlanById } from '@deepseek-ai/dsh-client-ui-token-usage'
```

## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 模块

| 文件 | 职责 |
|---|---|
| [`src/billing.ts`](src/billing.ts) | 计费引擎纯函数：标准单价、套餐目录、额度扣减、超额计费、人民币格式化 |
| [`src/token-usage-settings.ts`](src/token-usage-settings.ts) | 持久化章节 schema：生效模式（标准 / 套餐 + 记账）与计费时段 |
| [`src/index.ts`](src/index.ts) | Host 半数：注册 `ui-token-usage` 设置命名空间 |
| [`src/client/controller.ts`](src/client/controller.ts) | 控制器：订阅设置快照、切换模式 / 时段、记录调用并回写额度 |
| [`src/client/TokenUsageSection.tsx`](src/client/TokenUsageSection.tsx) | 设置页：模式卡、套餐目录、额度仪表、模拟调用与账单明细 |
| [`src/client/store.ts`](src/client/store.ts) | 页面 store：持久化快照镜像与模拟表单草稿 |

### 计费公式

标准计费（元）：

```
cost = (hit × rateHit + miss × rateMiss + out × rateOut) / 1,000,000
```

套餐里程（单位：tokens 或积分）：

```
token-allowance: units = hit + miss + out
credit-pool:     units = (hit × rateHit + miss × rateMiss + out × rateOut) / 1,000,000
```

套餐内扣减与超额：

```
remaining = max(0, allowance − used)
inPlan    = min(units, remaining)          # 套餐内费用 = 月费 / 额度 × inPlan
excess    = units − inPlan                 # 超额按桶比例切出超额切片
overage   = standard ? 按模型单价计价 : flat ? 超额切片 tokens × 单价 : 超额积分 × 单价
```

</details>

## 已知限制与延期工作

- **模拟调用是手动录入**——真实链路（会话 Turn 用量自动记账）需要 ui-chat 侧接入，本包目前以设置页模拟表单 + 引擎导出函数提供计费入口。
- **套餐目录为内置常量**——目录可在代码中维护（增删条目），尚未提供运行时编辑 UI；刊例价随上游调整时需同步更新条目并说明来源。
- **峰谷时段按固定规则**——DeepSeek 高峰时段（工作日 9:00–12:00、14:00–18:00，北京时间）由用户手动选择，未自动判断请求时刻。

## Model Experience

- 本插件不添加任何模型可见内容：不注入提示词、消息、schema、工具，不发起模型调用。
- 设置文档（`ui-token-usage` 命名空间）与页面展示均为本地持久化状态，不进会话日志。

### KV Cache 影响

不直接失效；令牌计量不改变请求内容。