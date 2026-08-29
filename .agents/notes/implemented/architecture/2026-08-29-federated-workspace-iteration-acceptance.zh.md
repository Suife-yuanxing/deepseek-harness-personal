# Agent Note：联合工作区迭代——管理 UI、存在性探针与缺失的 createFederation 灰度闸

状态：已实现

日期：2026-08-29

## 问题

功能代码面（阶段 0–3）早已完成，但验收表的最后一公里未收口。对真实部署的活体驱动暴露出三个缺口：

1. **`workspace.createFederation` 没有灰度开关闸。** 规格第 7 章要求开关同时拒绝两扇创建之门——`session.create` 认领与 `createFederation`——而解析不受闸。此前只有认领门有守卫（api-proxy 的 session.create），开关关闭时 wire 调用方仍可铸造新联邦。包级测试漏检：所有 createFederation 测试的 harness 都经同一条无闸 wire 播种；是活体的关闸探针抓到的（返回 `federation-name-conflict`——请求冲进了本该被 `federation-disabled` 拦下的位置——而非闸错误）。
2. **联邦在 UI 上不可管理**：`renameFederation`/`deleteFederation` 从 wire → apiproxy → 客户端 manager 全链路就绪，却零消费点——建错的联邦只能手改 `~/.dsh` 存储。
3. **成员目录消失静默无声**：registry 的 missing-dir 宽容语义永远保留行，但没有任何标记，过期成员的第一个信号是建会话报错。

## 决策

1. **闸**——`createFederation` handler 顶部一处 `federatedWorkspacesEnabled` 检查应答 `federation-disabled`，与认领守卫对称。关闸回归测试经 registry 直播种持久行（闸在 registry 之上，"开启时成为持久行、部署随后关闭"才是诚实前提）；常开套件显式传 `federatedWorkspacesEnabled: true`。
2. **管理块**——浏览器在持有联邦时于会话树上方渲染联邦行：叠层文件夹图形、成员 tooltip（主根标注）、×N 胶囊，以及悬停菜单的重命名（对联邦标题集做重名校验）与删除（确认对话框言明非破坏性语义：文件夹、工作区与会话记录保留，现有联合会话继续解析——删除在 unary 应答时关框，行随基线刷新消失，镜像 manager 的单安装路径收敛）。管理块仅宽态渲染且不受灰度开关约束：关闸恰恰是残留联邦需要清理之时。
3. **存在性标记**——list 处理器（`workspace.list`、`workspace.listFederations`）对每个工作区路径／联邦成员做 stat 并以 `missing`／`missingMembers` 标注行。视图类型上的可选字段（`undefined` = "未知"而非"存在"）让全部 fixture 与替身零改动；刚校验过成员的变更类响应省略标记。呈现面：选择菜单行与浏览器行加「已失效」标记、tooltip 标注受影响成员、创建面板将此类工作区锁定在成员集之外并内联说明原因。

## 已否决的替代方案

在 registry 内部做闸被否决：registry 是持久真相（其方法必须无视部署策略照常工作，否则"开启期播种、随后关闸"的行将无法存在）；部署策略属于 wire handler。把 `missing` 作为 changed frame 推送被否决——存在性是时点探针而非持久事实，frame 会暗示持久变更；它随被探测的那次基线走。在侧栏之外另设"联邦管理面"被否决——纯属为了界面而界面：行只有三个动作宽，浏览器本就拥有重命名/删除对话框模式。

## 后果

开关关闭时两扇创建之门都应答 `federation-disabled`，而 `list/listFederations/rename/delete` 与既有联合会话照常工作——规格的回滚语义端到端成立并有关闸 wire 测试钉死。联邦在 UI 上完全可管理，过期成员在选择时可见而非认领时撞错。已在 local 轨（v0.5.2 壳）活体验证：管理块渲染、选择菜单行/徽章/tooltip、UI 创建 → 侧栏块回显、认领 → chip ×2 + 主根分组归属 + 重启后 header 还原、跨根 fs 与 bash 写入落成员根、关/开切换语义、篡改冲突。
