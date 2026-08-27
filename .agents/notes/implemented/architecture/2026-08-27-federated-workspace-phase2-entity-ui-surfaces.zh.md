# Agent Note: 联合工作区阶段 2 —— 实体 UI 面

状态：已实施

日期：2026-08-28

## 问题

阶段 1 之后后端能力齐备——持久化 federation 记录、wire 四方法、`sessions.create` 认领路径、灰度开关闸门——但浏览器侧没有任何入口能创建联合工作区、从它发起会话，或在任何位置看到会话的多根身份。

## 决策

全部承载于三条既有通道，零新增框架扩展点：

1. **选择菜单（条目 + 徽章）。** `workspace.list` 现在同时携带持久化 `federations` 行与部署灰度位（`federatedWorkspacesEnabled`），选择流程从它已订阅的同一个 `useWorkspaces` selector 快照读取二者——不加第二条订阅通道、不做配置镜像（微决策 2）。行排在普通工作区之后；叠层文件夹图标是两个 currentColor 圆角矩形错位的内联 SVG；计数胶囊（×N）与悬停成员 tooltip 借同一 `MenuEntry.label` ReactNode 单元呈现。微决策 5 的降级路线从未启用：`label` 与 `icon` 都接受 JSX。
2. **认领流（零对象层知识）。** 选中行的注入回调执行 `workspaces.startFederatedSession(federationId)` 并打开返回的会话 id；创建经创建面板调用 `createFederation`。两者都是 apply 闭包提供的普通回调（微决策 3 的最终形态：宿主解析主根 cwd、成员根与挂靠——早期方案中客户端 `slice(1)` 深动词链被 2.2b 的服务端认领取代）。认领失败复用共享错误对话框并改用联邦专属标题。侧栏浏览器带同样完成回调但保持 add-only 形态（不出联邦行）：它的手势是注册目录而非发起会话。
3. **创建面板。** ui-workspace 内的 Modal 以 `role="checkbox"` 切换行列出已注册工作区（勾选顺序即成员顺序），每行勾选后提供「设为主文件夹」ghost 按钮（移到第 0 位、其余保持相对次序）；标题默认为 basename 以 `' + '` 连接并在成员集合变化时重算，用户一旦输入即停跟；少于两名成员时确认钮禁用且旁有本地化提示；业务失败以 alert 内联显示而面板保持打开供重试。面板状态是实例本地 useState——每次打开都重挂载，因此不存在跨面板 store（props 阶梯第 5 条）。
4. **会话内 chip。** `SessionSummary.additionalRoots` 经单一投影函数（`sessionListFields`：cold 行、attached 行与 `session-added` 帧）送达每一条摘要路径，镜像 header 直传而不引入新帧（微决策 6 落地）。`FederatedRootsChip` 占用既有 `'conversation.input.dock'` list 席位 `order: 30`（最贴近 composer 卡），从全局 `useSessions` 当前行渲染；普通或缺 cwd 会话渲染 null——回归红线由组件 spec 按 DOM 缺除断言，不靠肉眼评审。

一条值得记录的样式后果：面板成员列表使用 `--dsw-alias-bg-layer-2`，把该 sheet 放上了滚动条守卫的 elevated 层级；守卫在评审期抓住了缺失的重绑定，`.memberList` 依滚动条契约重绑定 l2 thumb/hover 对——这是 palette-ladder 推导自建立以来第一次真实命中。

## 备选方案

把联邦数据作为 picker owner props 下发需要拓宽两个 owner 契约（hero 与 add-only 侧栏）并复制运行时已有的订阅；沿既有 hook 读状态让接缝小于任一备选。给共享 `MenuEntry` primitive 增加 trailing 元数据字段会把功能关切推进 `ui-primitives`；label 的 ReactNode 已满足胶囊加图标的视觉态，primitive 因此保持未动。chip 若落在 conversation 自有 store 或新开专用槽位都输给既有 dock 席位：数据本就全局可得、摆放归属 queue/todo 条目家族、slots.inject 保证 HMR 回滚对称。

## 后果

灰度关闭时部署渲染逐字节不变（enabled 位隐藏全部行与动作），满足验收第 6 条的 UI 半边；开启后增加联邦行、「新建联合工作区」动作与 chip。开关开启且无 directory-flow 占位时，唯一的新建联合条目显示单行菜单而非原先的空 popover——这是有意为之、受开关门禁的可见变化。验证落在 `packages/client/ui-workspace/tests/`（菜单排序/徽章/tooltip/灰度门禁/认领/创建全流程；面板禁用-设主-标题-内联错误各例）、`packages/client/ui-conversation/tests/federated-roots-chip.client.spec.tsx`（标记、普通会话 null、tooltip 行构造器）、apiproxy 摘要/帧透传测试，以及 `DSH_SNAPSHOT=replay pnpm run test:web` 证明默认装配输出不变。
