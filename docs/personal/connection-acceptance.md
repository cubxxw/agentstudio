# 连接简化验收账本

GET-479 · 2026-11-10 · **本机回归、真实 Codex/公开 MCP、四服务合成过程已通过；Claude 真实执行未成功，最终包与远端交付核查待填。** 本账本只记录新增连接体验；GET-476 的 [Mac 验收](macos-acceptance.md)和[辅助 Web 历史](acceptance.md)不作为本轮新实现的通过分母。设计与源码依据见[连接设计](connection-design.md)。

## 版本与证据归属

- 开发基线：`eaf065d9cfe3d4d28bf3d3207aeae00c78f24f8c`；本轮实现仍在工作树中。最终 commit、build ref、包指纹：**待最终运行后填入**。
- Raft 研究：`db5e399f017d584e49597e3a28757645d6807893` / `v1.21.23-source.1`，源码只读与选型依据，不是运行验收。
- 本机原始证据根：`ai-test-get-479-connect-agents.6oCNYF`，使用隔离 profile 与合成输入。当前不发布 profile、凭据或私人历史；可发布截图/JSON 的最终副本：**待主执行者核对后填入**。
- 本文编写只读核对源码、研究报告和已有失败 JSON；没有另行启动模型、浏览器或 Electron。

## 已实际发生的首轮结果

| 场景 | 实际证据 | 结论 |
| --- | --- | --- |
| 本机发现 | Codex 0.163.0、Claude Code 2.1.273：installed/configured，adapter supported；Pi 0.85.1：installed/unsupported；Gemini/OpenCode：未找到 | 发现与支持状态已区分；不证明远端认证有效或推理成功 |
| 原生连接页与默认流程 | `real-5CLQ9r/failure.json` 保存四项先行断言；同目录 `connections-discovered.png` 保存界面 | 能发现 Codex/Claude 配置、如实显示 Pi、不默认露出高级字段、一次点击选择 Claude；该次整段流程失败，不能标完整通过 |
| Claude 真实任务 | 同一 `failure.json`：`real task completes (blocked)`；运行者另报 75 秒诊断 stdout 为 0 后超时 | **未成功**，原因尚未确定；没有真实报告，不能由 configured、无页面异常或假 CLI 测试代替 |
| UI 静态检查 | 新组件接入后 `pnpm --filter @agentstudio/personal typecheck` 通过，改动文件差异格式检查通过 | 只证明当时类型/格式；最终构建和运行回归另计 |
| Connector/个人服务针对性回归 | Grok 修正后的 50/50 子集由执行者报告，完整证据待汇入 | 仅修正后的合成子集结果，不冒充最终 desktop 全量，也不重复相加 |

首次 Claude 过程在任务 blocked 处停止，后续 Codex、公开 MCP 和重启断言没有由该次脚本到达。脚本包含步骤不等于已执行。之后的修复与重跑追加新记录，保留此次失败，不改写成“首轮全过”。

另一次 `real-T35c59/harness-correction.json` 记录验收脚本没有等选择完成，实际仍选中 Claude。已明确取消，`localAgentId: claude`、`cancelPending: false`；这是测试等待错误，不算 Codex 产品失败，也不是任何模型执行成功。

## 已确认的后续本机结果

主执行者随后确认 backend **61/61**、desktop **90/90**、desktop Node/web 与 personal 类型检查、构建，以及辅助浏览器 **24+18** 项通过，浏览器无页面异常。edge 18 包含后来新增的三项自动 URL/失败保留测试，替代先前的 edge 15，不重复相加。dev/registry 新增 9 项加旧 4 项，**13/13 首次通过**。独立第六轮审查已闭环，无剩余 P0/P1/P2。50/50 子集不再加入 desktop 90 的分母；浏览器、原生流程和单元测试也不混算。最终交付日志副本及源码/构建指纹仍需补齐。

真实过程 `real-TrmuAp/results.json` 已读回 **13 项断言、errors: []**。`local.executionAgent` 与成果 source 均为 `codex`。真实 Codex 产生 187 bytes Markdown，SHA-256 `dba475bed350c83739c76e78f873917df31b5d85e349309bafe4060d2709c4af`；公开 DeepWiki 返回 1605 bytes，SHA-256 `c8ebec9284c49092ead741e1637315348a6743664f32441bbe847370182529a9`。

该过程实际完成 DeepWiki 和 Exa 的一键握手，实际工具执行是 DeepWiki 读取 `facebook/react` 公开文档；没有声称调用了 Exa 搜索或私有账号。工具调用在精确批准前等待，批准后保存真实结果；应用重启后选择、连接和已完成任务仍保留。三个 capture 均记录为 `native-window`，没有 fallback，图为 `connections-discovered.png`、`codex-real-result.png`、`connections-linked.png`。输入只有合成阅读计划与公开仓库资料。

结果 JSON 沿用的一条“点击选择 Claude”断言文案不能证明 Claude 输出成功；实际执行者以 `local.executionAgent: codex`、成果 source 和对应 run 为准。此前 Claude 失败继续保留。

## 四服务原生合成结果

另一个隔离证据根 `ai-test-get-479-personal-services.HnPw8y` 的 `native-synthetic/synthetic-FTWItq/results.json` 已读回 **36/36、errors: []**，七组截图均同时有系统窗口与 renderer 版本。该流程在实际 Electron 中使用四个 fake 服务：Cue/Grok 各两个身份，Muse/Dots 各一个，共六个；不是六个真实私人账号。

Cue 默认走合成网页登录，测试 App 接收其专属回调。四服务完成登录进度和后端登记，native catalog/progress 无 token 或 endpoint 字段；没有导入原服务历史。provider 提交计数在批准前为 0、批准后为 1，重启后仍为 1；重启保留六个身份、同一任务/单 run/原成果，不重复创建后端连接或 A2A 任务。关联的合成中英文回复实际保存为成果并校验 SHA。760px 窗口、深色、连接按钮可达、无横向溢出及 Esc 已检查。

首次 `synthetic-iGJva6` 在脚本 dynamic import 夹具处失败，改用 `getBuiltinModule` 后重跑得到上述 36/36；该次修正没有改产品代码，不能记为合成首轮全过。真实私人账号、额度和外部效果仍未验收。

## 冻结源码验收与交付读回

本文件随源码提交，记录提交前的验收。之后 CI、合并与最终安装包的精确版本统一读回到 PR 检查和本机 `/Users/cubxxw/data/agentstudio-references/get479-delivery/README.md`；构建指纹以实际运行的 `/api/health` 为准，避免把文档自己的后续提交误当成已测试包。

| 验收项 | 当前状态 | 最终需要的回执 |
| --- | --- | --- |
| Personal backend 全量 | **61/61 通过**，主执行者确认 | 最终日志副本、命令与源码指纹待归档 |
| Desktop 全量 | **90/90 通过**，主执行者确认 | 最终日志副本待归档；子集不重复计数 |
| 类型检查及打包 | **desktop Node/web、personal 类型检查与构建通过**；本轮最终包读回待填 | 最终 build ref、renderer/后端指纹、包启动回读 |
| 辅助浏览器 | **24+18 通过，无页面异常** | edge 18 替代旧 15；最终 JSON/截图副本待归档，不冒充原生缩放或私人账号 |
| Dev/registry | **13/13 首次通过**（新增 9 + 保留 4） | 最终日志副本待归档，不加入 backend/desktop 的分母 |
| Codex 真实执行 | **13 项原生真实流程内通过** | `real-TrmuAp/results.json`，187 bytes/source codex；最终发布副本待归档 |
| Claude 真实执行 | **已失败，尚未成功** | 原失败保留；后续如成功需新运行、实际 identity/输出及原因归属，不能改账号/提供方补成功 |
| DeepWiki/Exa 一键握手 | **本轮真实通过** | `real-TrmuAp/results.json`，两预设无需输入 URL/凭据，重启保留 |
| 公开 MCP 实际调用 | **DeepWiki 本轮真实通过** | 同一结果 JSON，批准前等待，批准后 1605 bytes；Exa 仅证明握手 |
| 自己的 URL 与高级连接 | **浏览器新增三项通过**；协议/idempotency 另由全量测试覆盖 | 无 token URL 自动命名/识别、默认无高级字段、不安全 HTTP 失败后输入保留；仍不称真实私人服务 |
| 四种原生个人服务 | **36/36 原生合成通过**，脚本夹具修正后重跑 | `synthetic-FTWItq/results.json`，六个合成身份、七组 OS/renderer 截图；不能称真实账号 |
| stop_unknown 与未知恢复 | 全量回归通过；**针对性回执位置待填** | 取消/超时后确认退出；未确认则 unknown、同助手跨事情阻止派工；重启不绕过，只终止自有进程 |
| Mac 视觉与交互 | 760px/深色/无横向溢出/按钮可达/Esc **已在本轮合成过程检查** | 七组截图；完整物理键盘/VoiceOver 与本轮真实 Electron 200% 尚未证明，不借旧版补验收 |
| CI / 合并 / 合并后回读 | **待提交后核查** | PR/commit、最新 head 门禁、合并 SHA 与运行读回；本地通过不代替 |

## 每类结果的边界

1. 发现不调用模型、不发测试正文、不读认证文件，只返回白名单状态。缺失、超时、恶意输出、输出上限、取消和真实异步等待使用隔离 fake executable 测试；是否通过以最终重跑为准。
2. 选择保存到设置并固化到新 run；重启后保留，旧 identity 不被切换改写。登录必须是固定厂商动作，界面不能提交 executable/args。Pi/Gemini/OpenCode 没有执行 adapter，不能出现假可用或假连接成功。
3. 四服务合成验证使用隔离登录页/客户端、合成 token 和本机 A2A。测试服务 ready 只证明封装合同。**本轮没有四个真实私人账号的登录、额度、历史连续性或外部效果验收**，不能把 fake 服务替换成同名真实通过。
4. 已存 token 和本机 A2A 凭据不随进度返回 renderer；用户主动输入密钥经过一次性密码框/固定 IPC，不是读取其它应用凭据。应核对返回、模型上下文和回显去敏，不能只凭字段名判断没有泄漏。
5. stop_unknown 对应实现 `stop_unconfirmed` / `stopUnconfirmed`。未确认停止不释放同助手新派工，本机取消不证明远端取消。个人服务只查询原 task ID，不重发、不删未决实例；未知就保持未知。
6. Bearer 为 AES-GCM 文件 vault；原生会话为独立 Chromium 分区和 `safeStorage` 加密文件。两者都不证明账号所有权，文件 vault 不是 Keychain；丢失/损坏密钥或连接删除失败保留数据和核查渠道。

## 收尾填写规则

最终填写实际结果、精确证据、源码/构建标识和限制。保留首轮失败、修复与重跑次序；合成、真实 CLI、公开服务、私人账号、原生包、CI、合并分别记录。未执行写“未执行”，失败写“失败”；不以测试计划或脚本中未到达的断言补通过数字。
