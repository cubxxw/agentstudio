# 点一下接入已有助手

GET-479 · 2026-11-10。沿用现有 macOS 个人工作间，把协议、地址、凭据表单从默认路径收进高级连接。实现与验收分开：[本轮验收账本](connection-acceptance.md)尚未完成，Claude 真实执行尚未成功，四个个人服务的合成验证不代表私人账号接通。

## 观察与选择

改造前的基线连接页要求名称、A2A/MCP、端点、可选令牌；本机只在启动时执行一次 `codex --version`，将安装与可用混为一谈。默认 personal 模式也没有使用原生客户端已有的四种个人服务登录。用户因而需要掌握协议、找地址、判断账号和验证结果。

核读版本：目标 `eaf065d9cfe3d4d28bf3d3207aeae00c78f24f8c`；Raft [`db5e399f017d584e49597e3a28757645d6807893`](https://github.com/botiverse/raft-source/tree/db5e399f017d584e49597e3a28757645d6807893)，本次本地 HEAD/tag 读回为 `v1.21.23-source.1`，研究阶段远端 HEAD 同 SHA。它是 FSL-1.1-ALv2 发布源码镜像，不能代表私有开发版或在线运行结果。本项目独立实现，没有迁入 Raft 源码。外部 Agent 身份绑定与本地执行器发现也不是同一机制；更多协调观察见[既有研究](research/raft-observation.md)。

| Raft 已核读的源码事实 | 本轮取舍 |
| --- | --- |
| [固定 runtime catalog](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/shared/src/runtimeCatalog.ts#L30-L51) 分离稳定 ID、二进制和支持状态。 | 使用固定白名单，发现不等于支持执行；旧快照的 deprecated 标记不当作其它产品今天的现状。 |
| [有界 probe](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/daemon/src/drivers/probe.ts#L403-L468) 与[检测轮次](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/daemon/src/runtimeDetectionRound.ts#L15-L47) 分离发现过程和结果。 | 异步、小并发、超时、缓存和刷新合并；Finder 补普通路径，不 source shellrc。 |
| [顶层 login](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/cli/src/commands/agent/login.ts#L125-L156) 接收已有 token；[login start](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/cli/src/commands/agent/login.ts#L215-L238) 才开始设备授权。 | 核对真实固定厂商命令，不能从手册推断顶层 login 必然弹出授权页。 |
| [Codex 驱动默认权限](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/daemon/src/drivers/codex.ts#L911-L914) 包含 `danger-full-access` 与 `approvalPolicy: never`。 | 不沿用宽权限默认值，连接便利不扩展任务权限。 |

比较三个方向：把旧表单做成向导仍要求用户找协议和地址；统一自动发现加服务登录能直接复用已有安装和账号；新增通用市场会扩大安装、权限和配置成本。选择第二种，手动方式作为后备。

## 用户过程

1. 打开“连接”，看到这台 Mac 上发现的助手及当前使用者。点击“使用”便可采用已有配置；安装、检测到登录配置、已启用与执行成功分别显示。不会为用户自动切换账号或模型提供方。
2. 点个人服务的名称进入其登录流程，选择账号或已有 Agent。主进程完成连接登记，界面不接触凭据。之后直接在同一工作间派发事情；使用对方原有对话的范围要说清楚，不自动导入历史。
3. 常用工具提供固定预设；连接成功前仍做实际握手。自己的服务只需要粘贴地址，系统尝试标准元信息识别并命名；无法可靠识别时才显示高级协议选择。
4. 未安装、登录失效、网络离线和服务不可用各有对应动作；修改连接不会把结果未知的旧写入重新执行。移除入口不隐藏进行中的事情。

## 工程约束

- 本机发现只运行固定目录的版本和非交互登录状态探针，不读取凭据文件、私人对话或 shell 启动文件。超时、输出上限、并发与缓存受控。安装命令路径不由 renderer 提供。
- 首批执行 Codex、Claude Code；Pi 等没有完成执行/工具控制合同前只如实显示已发现。每个任务固化其本机执行者，后续切换不改变已接受任务。
- 个人服务复用现有原生 ConnectorManager，但使用单独存储/网页分区和本机 A2A 适配；不启动 Matrix，不读取旧连接器凭据。已存凭据不回传 renderer，由主进程向自有后端登记；用户新输入的边界见下文。
- 本机适配先持久化任务再发送；按消息标识幂等，原文历史与用户在原服务的输入不能作为本次回复。恢复先核查，未知任务不自动重发。服务自己的内部权限不会被本产品的提示词限制。
- 新 native 能力仍只允许可信顶层本地页面和固定动作。辅助 Web 不伪装拥有原生浏览器会话登录能力。

## 验收

用相同任务核对：本机扫描→点击选择→实际报告；切换后重启仍保留选择、旧任务仍保留原执行者；常用 MCP 点击后真实握手与读取；个人服务登录和 A2A 适配用隔离合成服务验证协议、重复点击、历史过滤、授权和重启未知状态，再如实区分私人账号的实际验收范围。保留 Mac 窗口、深色、窄窗、键盘可达及截图，记录实际点击与输入数量，不能只以新增连接数作为改善证据。

## 本轮实现范围

**这台 Mac** 自动发现 Codex、Claude Code、Pi、Gemini CLI、OpenCode 五种固定 ID，仅 Codex/Claude 有执行 adapter。其余收进“其他助手”，提供官方安装入口或未支持说明。本轮机器快照为 Codex 0.163.0、Claude 2.1.273 installed/configured，Pi 0.85.1 installed/unsupported，Gemini/OpenCode 未找到；这不证明远端认证、额度或真实推理可用。

版本与认证分开：固定 `codex login status`，Claude 使用默认 JSON 的 `claude auth status`，只保留登录状态和白名单认证方式。默认探针 2.5 秒、并发 2、缓存 15 秒；原始 stdout/stderr 不送界面。发现不会触发登录或模型；未登录时明确按钮才启动固定 `codex login` / `claude auth login`。renderer 不能指定 executable、argv 或环境。显式 Codex 路径覆盖失效不暗中换候选。

选择固化为每个 run 的 `localAgentId`，后续切换不改变旧任务。`mode: codex` 是兼容保留的自动安排模式名，选择 Claude 后不会因此改回 Codex。Codex 保留 ephemeral/read-only/JSON exec；Claude 使用独立非交互 JSON adapter、safe mode、无工具、空 MCP、plan 权限、禁用 hooks 和会话持久化，并先核对 CLI 参数能力。输入走 stdin，只提取成功的最终事件，不用 stderr 或半截输出当报告。超时、输出上限与取消只停止自有子进程组。adapter 存在不等于真实执行通过，Claude 当前失败仍须保留。

**你的个人 Agent** 固定 Grok Bot、Muse、ChatGPT Dots、Cue。Muse/Dots 通过服务网页会话工作，Grok Bot/Cue 使用原连接器的专属授权与 API 适配；不是通用 OAuth。个人模式使用独立 `personal-services` 存储和 `persist:agentstudio-personal-services-*` 分区，不迁移旧 Matrix 或其它浏览器 profile。等待、选择、输入、取消和恢复都经固定 `nativeIntegration`；主进程登记后才 ready，`canOpen: false` 显示去原 App 确认。服务内部工具和决定仍由原服务处理，不自动批准。

**常用能力** 提供 DeepWiki/Exa 固定公开 MCP 预设，点击后做真实握手与工具发现，成功才显示已连接，已有连接禁重复。自己的服务只需 URL，可选 Bearer：尝试同源标准 Agent Card，识别 A2A 名称/端点，否则尝试 MCP 初始化。失败保留输入；高级表单保留旧 testids。不会扫描端口段或支持 stdio MCP；URL 不含账号、查询参数或片段，远端要求 HTTPS，HTTP 仅限回环。连接不代替后续精确内容、参数与读回范围批准。

## 凭据与界面的准确边界

已保存的服务凭据和本机 A2A token 不随 catalog、progress、ready 或普通 API 返回 renderer，主进程直接登记。用户主动选择密钥方式时，密码框会短暂接收新输入，经固定 IPC 提交后清空；不能说 renderer 从未接触用户输入。恢复仅保存 flow ID、类别与标题，不保存密码或 token。

原生 ConnectorStore 使用 Electron `safeStorage` 加密文件和独立网页分区；后端 Bearer 仍使用 AES-256-GCM **文件 vault，不是 Keychain**。两者不可混称，也不证明远端账号所有权，不能隔离同一 OS 用户下的进程。密钥和密文应一起保护；恢复加密连接失败时保留原文件并报错，不清空后伪装首次登录。返回与模型上下文不包含 token，已知 token 的服务回显需在保存前去敏。

## stop_unknown 与核查

本机停止先提出取消，再等自有进程退出确认。无法确认时记录 `stop_unconfirmed` / `stopUnconfirmed`（验收场景称 **stop_unknown**），保留 unknown、不保存成功结果，并阻止同一助手的新派工。再次取消或重启不能清除此门槛。应核查原任务和该次进程，不用全局杀进程、改提供方或假定退出成功恢复界面。

个人服务发送前持久化 message ID 和 payload 指纹；同 ID/同内容返回原回执，每实例只容纳一个未解决任务。仅本次可关联回复进入结果，历史、其它用户输入和后台自主消息不算完成。中断、发送响应丢失或回复归属不明保留 unknown；`tasks/get` 只查询原 task ID，不变成新的 `message/send`。未决实例不可删除，未知就保留核查渠道，打开原 App 不等于已核查完成。

已有持久队列与每个 run 的上下文截止点继续生效。连接改动不重放旧动作、不改写已接受输入；“连接”“已读”“完成”“外部效果核查”“用户接受”分别记账。
