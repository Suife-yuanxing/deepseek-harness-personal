# Agent Note: 联合工作区阶段 3 —— Windows ACL 的 bash 多根

状态：已实施

日期：2026-08-28

## 问题

阶段 1 已让 `writableRoots()` 合并 `additionalRoots`，但只有 fs 消费者读它：Windows 上联邦会话的 bash/pwsh 子进程运行于受限 token，其写能力列表只含主根身份，成员根的写入被拒——而同样的路径经 fs 工具却成功。这正是规格风险登记册预警的权限分裂。

## 决策

每根一个身份，端到端按位配对：

1. **argv 协议**（runner）：每个附加成员在 `--workspace` 之后用一个可重复的 `--writable-root <dir>` 标志承载。主根沿用既有字段名与 `--write-sid` 配对校验——协议对既有 argv 构造方保持兼容。两端都用既有的确定性 `workspaceWriteSid()` 从各自规范路径推导全部工作区 SID，因此线上不传输额外 SID 标志。校验在 runner 边界响亮失败：不存在或重复的成员 exit 127；read-only 拒绝一切附加根；`assertTempRootOutsideWorkspace` 现在对每个成员都执行、先于任何 spawn。
2. **受限 token**（`AclSandbox`）：新增位置配对——`additionalWriteSids` 与 `writeSids[0] === writeSid` 并列。授权按目录落到它自己的身份上（`grantWrite(writableDirs[i], writeSidPtrs[i])`），且 `createRestrictedToken` 一次性接收全部分析后的指针（token 层本来就吃数组）。构造校验要求每多一个目录恰好多一个身份，且与主根及彼此两两不同。默认 DACL 的选择（temp SID 优先）不变。
3. **接缝**（`LocalSandboxProvider`）：授权生命周期按实际变化的维度拆分——`materializeWorkspaceGrant(root)` 为每个成员根立一份常驻 ACE（复用缓存，照旧以 root 为键），`materializeSessionTemp(sessionId)` 把可撤销随机 temp 改为按会话键控，因为一个联邦的全部成员共享同一个私有 temp。`windowsAclRunnerArgv` 物化所有成员后，在 `--workspace` 与 `--temp` 之间为每个附加根发出一枚 `--writable-root`。任务 3.2 因此只改了这一个 seam 方法——bash 消费端调用 `confine()` 完全未动。
4. **e2e**：`federated-roots.e2e.ts` 增补 fs 矩阵的 bash 镜像（成员写入落进自己的 SID、外来路径被拒、相对路径锚定主根）。组合的 bash 执行器固定 spawn `bash -c`，Windows 上没有 bash 二进制，因此该块在 win32 自跳——等价验收由 sandbox-windows-acl 的 runner 套件真实执行（真实 WRITE_RESTRICTED token 通过派生 SID 写入成员根）。

## 备选方案

跨成员共享单个能力 SID 两度被否：复用主根 SID 会令任何在单一成员上工作的会话进入为其他联邦授予的兄弟树，破坏「每路径身份」模型支撑的跨会话复用语义；铸造按联邦复合的新 SID 则只放大 ACE 传播却不增隔离。逐成员新增 `--<root>-sid` 线上字段被否，因为两端本就同意同一推导函数——原样传递派生值徒增篡改面而没有信息量。把授权生命周期按变化维度拆分（root-常驻 vs session-temp）取代早先的 [session, workspace] temp 键，正是因为共享私有 temp 属于会话本身，而不属于任何成员配对。

## 后果

联邦会话的受困子进程现在可以写每一个成员根；外来路径与逃逸的否定面与从前逐字节一致（未变的负例已钉死）。每个成员的常驻 ACE 独立并入按工作区的复用缓存，因此创建联邦从不需要重新传播此前已被授权过的树。验证落在 sandbox-windows-acl 的 stub 化 constructor/init 套件（配对与互异契约、三份 grant 的 happy 流水线）、provider-chain 的 argv 断言（每成员一枚标志、`--workspace`/`--temp` 间次序保持、第二次 confine 复用两项授权）、全部三类边界拒绝与成员写验收的真实 token runner 探针，以及 e2e 块的 POSIX lane。
