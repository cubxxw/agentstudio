# Personal 工作间与连接

`apps/personal` 提供共享 React 界面及本地 Node/SQLite 引擎。默认产品入口是现有 [macOS Electron 应用](../desktop/README.md)，沿用原生窗口、侧栏和菜单；独立 Web 仅作开发与辅助 QA，没有原生个人服务登录能力。

## 连接已有助手

在 Mac 应用打开“连接与偏好”：

1. **这台 Mac** 检查 Codex、Claude Code、Pi、Gemini CLI、OpenCode。仅 Codex/Claude 有执行 adapter；检测到本机登录配置时点“使用”，决定之后任务的默认执行者。其它只作发现/安装提示。安装、配置、支持执行、任务成功分别记账；Claude 本轮真实任务仍未成功，见[验收账本](../../docs/personal/connection-acceptance.md)。
2. **你的个人 Agent** 连接 Grok Bot、Muse、ChatGPT Dots 或 Cue。按原生登录流程授权/选择，主进程登记后才就绪。使用原有对话，不导入历史，不迁移旧 Matrix 或其它浏览器的登录态。服务需要你决定时，到原服务核对，本产品不自动批准。
3. **常用能力** 点击 DeepWiki/Exa 完成实际公开 MCP 握手与工具发现。自己的服务先粘贴 URL，可选 Bearer，尝试标准 Agent Card 或 MCP 识别。仅在服务方要求时展开“高级连接”，填写名称、A2A/MCP 和地址。

发现不会触发登录、发送测试正文、调用模型、安装插件或改提供方。不读取 auth 文件、配置 token、私人历史或 shellrc；探针有超时、输出上限、缓存与并发限制。未登录时明确按钮才运行固定厂商登录，返回后重新检查。`configured` 只说明本机配置，不保证账号归属、额度或网络可用。

默认选择固化为每个 run 的 `localAgentId`；兼容保留的 `mode: "codex"` 指自动安排模式，不会把选择的 Claude 改回 Codex。后续选择不改写已接受任务。缺失 CLI、认证/额度失败或没有真实最终输出时保留阻塞，不生成替代报告或切换提供方。“本地资料整理”和合成体验是确定性统计/原文保存，不是 AI。

## 批准、凭据与恢复

连接不授权后续所有操作。A2A 提交与 MCP 调用仍展示精确目标、身份、内容/参数和可选读回，由你决定；目录描述、`readOnlyHint` 或别的任务批准不能跳过。每次只用这件事的上下文和显式记忆；运行时补充保存为队列，旧 run 不读后来才到的要求。

已存原生服务凭据及本机 A2A token 留在主进程/私有存储，不返回 renderer；密码框接收的新输入仅经固定 IPC 提交。原生会话使用独立分区和 Electron `safeStorage`；后端 Bearer 使用 AES-256-GCM **文件 vault，不是 Keychain，也不是账号所有权证明**。返回和模型上下文不包含 token，已知 token 回显保存前去敏。不要把 profile、密钥或加密记录提交仓库。

停止要等自有 CLI 退出确认。`stop_unconfirmed` / `stopUnconfirmed`（stop_unknown 场景）保留未知并阻止同助手新派工，反复取消或重启不解除。远端发送/回复归属不明也不重发；保留原 task ID、连接和核查入口，到原服务确认。文件哈希只证明字节一致，不证明外部效果或用户接受。

## 开发与文档

```sh
pnpm --filter @agentstudio/personal typecheck
pnpm --filter @agentstudio/personal test
pnpm --filter @agentstudio/personal build
pnpm --filter @agentstudio/personal start
```

Web 默认 `http://127.0.0.1:18740`，开发 Vite 为 18741。`PERSONAL_DATA_DIR`/`PERSONAL_PORT` 只调整独立服务；Mac 自有 utility 自动选端口、使用 Electron profile，不附着 Web 服务。生产 renderer 只走窄 IPC，不向 API 发 HTTP。

后端细节见[后端合同](server/README.md)；新增连接以[连接设计](../../docs/personal/connection-design.md)和[本轮验收](../../docs/personal/connection-acceptance.md)为准。旧 CLI/公开 MCP/原生包证据见[GET-476 Mac 账本](../../docs/personal/macos-acceptance.md)，不能拿旧数字代替本轮验收。四服务合成验证不代表私人账号接通；通用 OAuth、stdio MCP、账号所有权证明和公网部署不在本轮范围。
