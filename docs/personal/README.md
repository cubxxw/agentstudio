# AgentStudio 个人工作间：Mac 默认入口

从一句话开始，以事情为单位保存对话、执行、决定与成果。默认入口是仓库已有 macOS Electron 应用，沿用原生窗口、交通灯、侧栏和菜单；不需要先启动 Matrix 消息服务器。`apps/personal` 提供共享界面和引擎，独立 Web 运行保留为开发及 QA 辅助。

## 启动 Mac 应用

需要 Node **22.13+** 和 pnpm：

```sh
pnpm install --filter '@agentstudio/desktop...' --frozen-lockfile
pnpm --filter @agentstudio/core build
pnpm --filter @agentstudio/desktop build
pnpm --filter @agentstudio/desktop start
```

这会启动实际 Electron 窗口。开发入口是 `pnpm dev:desktop`；构建版从本地 `file://` 页面加载，不把本机网页地址装进窗口。它使用独立 preload 和固定 IPC 能力，主进程启动自己的 `utilityProcess`，后台使用 Electron 内置的 Node/SQLite。默认模式无需 Go、Postgres、Synapse 或桥接。

数据默认在 `~/Library/Application Support/AgentStudio/personal`。后台自动选择回环端口，校验自有子进程和工作区，不附着现有 18740 服务，也不自动读取或迁移旧 Matrix 会话、Web 工作区或浏览器账号。`AGENTSTUDIO_USER_DATA_DIR` 可隔离整个 Electron profile；`AGENTSTUDIO_PERSONAL_DATA_DIR` 可明确指定个人工作区。一个工作区只允许一个后台工作者。

`pnpm package:mac` 是本机 ad-hoc 打包入口，默认输出在 `apps/desktop/dist`，附构建和签名回执。实际 `.app` 的包内页面、独立 utility、结果导出及长文/深色/缩放已在本机检查，见 [macOS 验收](macos-acceptance.md)。它不使用 Developer ID，也不做 Notarization 或发布。安装、环境变量及包内路径见[桌面说明](../../apps/desktop/README.md)。

普通任务使用已安装、已登录的 `codex` CLI，沿用本机提供商配置。没有 CLI、登录失效或额度不足时保留任务、说明阻塞，不生成假结果或切换提供商。CLI 版本检查不代表账号、额度或某个任务已经验收。

不调用模型也能检查从输入到报告保存的流程：点“先体验一件小事”。系统明确使用合成文本，在本机完成实际统计、报告保存、SHA-256 与读回校验。它是确定性文本处理，不伪装为通用 AI。

## 使用过程

1. 直接说想做的事，或附上最多 5 份、共 1 MB 的文本资料。不要求先选 Agent、建项目或填写任务表。
2. 工作开始后可以离开页面，本地服务管理执行。运行中补充要求会保存为同一事情的后续执行，按顺序接着处理；当前执行不会读到后来才发的消息或附件。其他事情不会混入上下文。
3. 向远端发送内容或调用工具前，查看目标、具体内容和参数，再决定。选择记录、投递、执行与核验分别保存。
4. 打开成果进入独立阅读视图。Mac 中“存储原文…”使用原生保存对话框，写入后读回核对 SHA-256；辅助 Web 提供原文下载。来源、标题、表格和代码结构保留，关闭阅读视图回到原对话。
5. 返回后通过“需要你”找到未决与恢复事项；每件事有实际状态和执行记录。补充要求会使尚未批准的旧预览失效，新预览重新核对。未知的远端提交先核查，后续队列等候，重复点击不能变成新写入。
6. 在“连接与偏好”明确保存记忆。它们用于之后的执行，移除后不再进入新执行；已有消息和成果作为历史保留。

Mac 菜单注册 `⌘N` 开始新事情、`⌘K` 搜索、`⌘,` 偏好设置。`Enter` 发送，`Shift Enter` 换行，中文组词中的 Enter 不发送。报告支持键盘、宽表格/代码滚动、较大字号；减少动态效果遵循系统设置。

关窗在 Mac 上隐藏窗口，后台继续；从 Dock 重开原窗口。`⌘Q` 关闭本应用拥有的 utility，不关闭其他项目。排队任务可恢复；中断的远端结果先核查，不能把退出或本机取消当成远端撤销。后台意外退出最多自动拉起一次，进一步失败提供显式重启，重新启动不会代替原请求重发 POST。

## 连接与凭据

在“连接与偏好”选择自动发现的本机 Codex / Claude Code；安装、登录配置和实际执行分开显示。个人 Agent 的 Grok Bot、Muse、ChatGPT Dots、Cue 提供原生登录，常用 DeepWiki / Exa 直接点击连接。自己的服务只需粘贴地址，系统尝试同源 Agent Card 或 MCP；手工协议表单收在高级连接。登录已保存而登记回执丢失时，可点“继续连接”，无需再登录。详见[连接设计](connection-design.md)和[本轮验收](connection-acceptance.md)。

A2A 支持批准后的 `message/send` 和原 taskId 的 `tasks/get`；MCP 支持 2025 协议握手、工具发现、批准后的精确调用及预览中列出的读回。通用调度使用任务接受时选定的本机助手，之后切换不改写旧任务。连接存在不等于授权外发。MCP 正文保存为可读报告，去敏后的原始返回可在执行记录展开。

Bearer 保存在本工作区的 **AES-256-GCM 文件 vault**，不是 macOS Keychain，也不是远端账号身份或所有权证明。密钥和加密凭据均为 0600、目录 0700；应一起备份，丢失原密钥无法解密旧凭据。返回数据和模型上下文不包含 token；服务回显的已知 token 在保存前去敏。同 URL 的不同 token 分属不同连接，旧决定不能授权新凭据身份。未决或待核查任务保留其连接；安全删除连接只移除相应密文，保留工作区密钥。缺失或损坏密钥时保留原文件和任务，不生成新密钥覆盖；已验证恢复路径是恢复原密钥并重启服务。

通用 HTTP 连接没有 OAuth、自定义认证头或通用账号核验。四类个人服务使用各自专属登录机制、独立网页分区与 safeStorage 加密文件；不导入其他浏览器或旧 Matrix 登录态，也不导入历史。本轮四服务仅完成隔离合成验收，不代表真实私人账号已接通。Codex 与公开 DeepWiki 实际执行已通过；Claude 虽发现登录配置，真实执行尚未成功。

## 实际控制边界

- Mac 的生产 renderer 不发 API HTTP，`connect-src 'none'`；固定 IPC 只允许可信顶层本地页面，个人 preload 不暴露旧 session/connector API。utility 的 HTTP 只监听回环，并检查 Host、Origin 和跨站请求；不是多用户或公网服务。
- SQLite 内容没有端到端或整库加密。Bearer 的文件加密不隔离同一系统用户下的进程；设备账号、工作区密钥与备份仍决定本地隐私边界。
- 本机助手使用 `read-only` shell 沙箱，但既有 CLI 工具和插件按自身权限运行。独立工作目录不是文件系统隔离。禁止无关读取、外部写入的任务指令不能宣称强制控制所有插件。
- 远端自行管理身份、账号和工具权限。连接不自动继承浏览器账号、旧客户端登录态或别的 Agent 的工具。没有真实账号验收就不声称该账号连通。
- 哈希证明文件字节一致。远端声称完成、工具响应成功、外部效果已核查、用户接受是不同证据。
- Mac 关窗隐藏和辅助 Web 关闭页面不会取消各自后台。本地服务停止、退出应用、休眠或离线期间不承诺继续；启动恢复队列，潜在远端写入先保留未知状态。
- 不自动发布、创建周期任务或将自动推断写入长期记忆。

原 Matrix renderer/preload、Expo、Go 服务、A2A/ACP 与个人服务连接器保留；使用 `AGENTSTUDIO_WORKSPACE=matrix pnpm dev:desktop`，该模式另需原栈。个人模式不会自动初始化这些连接器或迁移它们的凭据。两条路径分别验收；没有移植 Raft 实现。

## 辅助 Web 入口

```sh
pnpm build:personal
pnpm start:personal
```

打开 `http://127.0.0.1:18740`；开发用 `pnpm dev:personal`，界面 18741、API 18740。此入口的数据在仓库 `.local/personal`，`PERSONAL_DATA_DIR`/`PERSONAL_PORT` 仅调整这条独立服务的目录/端口。它不是默认 Mac 入口，也不能用其浏览器验收代替桌面启动、生命周期或包内运行验收。

## 文档与检查

- [设计裁决](design.md)
- [Mac 决策记录](macos-decision.md)
- [macOS 原生验收](macos-acceptance.md)
- [Raft 源码观察](research/raft-observation.md)
- [官方视觉研究](research/visual-research.md)
- [会话候选](research/candidate-a.html)、[文档候选](research/candidate-b.html)、[队列候选](research/candidate-c.html)
- [首轮 Web 验收历史](acceptance.md)

```sh
pnpm --filter @agentstudio/personal typecheck
pnpm test:personal
pnpm --filter @agentstudio/desktop typecheck
pnpm --filter @agentstudio/desktop test
pnpm --filter @agentstudio/desktop build
```

后端测试使用独立临时 SQLite、假 CLI 和本机合成 HTTP 服务。桌面 host 测试检查信任边界、并发重启、关闭优先级和进程身份。真实 CLI、公开 MCP、私人第三方账号、原生包、辅助浏览器与旧客户端检查分别记录，见 [macOS 账本](macos-acceptance.md)及[首轮 Web 历史](acceptance.md)。

浏览器验收复用仓库现有 Playwright（需已安装 desktop 开发依赖和 Chromium / Chrome）：先在一个终端运行 `node dev/personal-qa.mjs`，再运行 `node dev/personal-browser.mjs` 和 `node dev/personal-browser.mjs edges`。隔离入口在 18745，合成远端在 18746；故意没有真实模型配置。截图、检查 JSON 与 trace 保存在 `output/playwright/personal`，CI 配置运行同一过程；本地通过与远端 CI 结果分别记录。不要把这个合成服务用作日常入口。
