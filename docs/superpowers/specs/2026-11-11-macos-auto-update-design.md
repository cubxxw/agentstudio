# macOS 自动更新设计

2026-11-11 · [GET-495](https://linear.app/getyak/issue/GET-495/design-macos-automatic-updates-with-a-restart-indicator) · 设计交付，尚未实现或发布自动更新。

## 交互决定

用户要求：有更新时，在 macOS 窗口左下角出现标识；点击完成重启更新；悬浮能看到当前版本到新版本的变化。沿用个人工作间已有导航，不另加横幅或常驻弹窗。

方案默认由 Agent 自主确定：后台检查、后台下载，准备好后再邀请重启。标识放在 `NavigationRail` 的 `.im-rail-bottom` 中，位于刷新按钮上方，设置按钮保留在最底部。这是应用窗口里的左下角，不是 macOS 桌面悬浮窗。

交互示意：[可点击的状态预览](../../personal/macos-update-preview.html)，检查记录见[设计验收](../../personal/macos-update-design-acceptance.md)。预览中的版本和状态是合成示例，不连接更新服务，也不会重启本机应用。

## 现有约束

- 默认入口是 Electron 个人 IM。保留的 Matrix 工作间使用不同的 renderer/preload，本轮设计只覆盖默认个人工作间。
- `apps/desktop/package.json` 当前版本为 `0.1.0`；打包脚本沿用 `com.cubxxw.agentstudio` 和既有资料目录。目前使用 `@electron/packager`，强制验证 ad-hoc 签名，没有 Developer ID、公证、发布 ZIP 或更新 feed。
- `PersonalDesktopBridge.restart()` 只重启个人后台，不能安装新版本。本功能使用独立更新 IPC，不复用它。
- 现有退出流程在 `before-quit` 中异步关闭后台和连接器；更新安装会先关闭窗口，不能等到该事件才保存或停止任务。
- `prepareWorkspaceSwitch()` 已能暂停调度、挡住新写入并检查未完任务，可抽取成通用的退出准备；还须覆盖原生登录、连接器发送和正在提交的请求。

以上来自本轮远端 `main` 的 `e25ebd7`。实现时重新拉取主分支，并复核后续窗口、聊天和生命周期改动。

## 方案比较

| 方案 | 收益 | 代价 | 决定 |
| --- | --- | --- | --- |
| Electron 原生 `autoUpdater` + Squirrel.Mac + 主进程验证的本地 feed | 沿用已有 Electron 和 packager；无需常驻更新服务器；自己控制提醒 | 需生成 ZIP/feed、预先核验包、正式签名、公证和专门的退出协调 | 采用 |
| `electron-updater` + electron-builder | 发布工具、下载进度、渠道能力较完整 | 要更换或另建正式打包链，重新验证现有打包与主进程依赖检查 | 后续需要多平台发布再评估 |
| 仅检查 GitHub Release，点开下载安装包 | 适合当前本地签名构建，工作量小 | 不能满足点击即重启安装 | 保留为手动更新退路 |

这是 Agent 根据现有仓库作出的推荐，不代表用户另行选择过技术方案。正式发布 prerequisites 未满足前，可以评审和实现本地状态/交互；不得把重启旧程序包装成更新。

## 左下角入口

1. 更新按钮使用 Lucide `CircleArrowUp`，20px 图标，40×40px 点击区域，12px 圆角。与刷新、设置同轴对齐，间隔沿用 14px，最底部仍留 16px。按钮为 `no-drag`。
2. 下载时出现低强调的下载图标，悬浮提示“发现新版本，正在后台下载”。下载完成后切为实心浅蓝底、深蓝图标，右上角 5px 实心点。它与刷新按钮的旋转箭头形状不同。无自动闪烁、弹跳或重复系统通知。
3. 悬浮或键盘聚焦时，浮层出现在按钮右侧，间隔 10px，宽约 248px。垂直位置贴近按钮但限制在窗口内 8px；小窗时向上展开，使用 portal 避免被侧栏裁剪。正文区不发生位移。
4. 就绪浮层：标题“新版本已就绪”；版本行“0.1.0 → 0.1.1”；说明“点击重启并更新”。版本等宽数字。示例数字不硬编码进产品。
5. 浮层是只读 `role=tooltip`，通过 `aria-describedby` 关联按钮；其中不放按钮或链接。悬浮离开可关闭，指针移进浮层时保持可读，Escape 关闭且不丢焦点；键盘聚焦呈现相同内容。待处理状态只播报一次，避免屏幕阅读器反复打断。
6. 无更新时不占用更新按钮位置。菜单“AgentRoom → 检查更新…”和“连接与设置 → 关于与更新”始终可查当前版本。窄窗隐藏导航时，这两个入口仍可访问；辅助 Web 不显示原生更新控件。

## 状态与点击行为

| 状态 | 左下角 | 悬浮内容 | 点击 |
| --- | --- | --- | --- |
| `unsupported` | 隐藏 | 设置显示“此构建请手动更新”及原因 | 设置可打开固定的项目更新说明 |
| `idle` / `checking` / `upToDate` | 隐藏 | 设置显示当前版本、上次检查时间；手动检查有结果反馈 | 菜单可主动检查，重复请求合并 |
| `downloading` | 低强调下载标识 | 当前 → 目标；“正在后台下载，准备好后可重启更新” | 打开关于与更新，不执行重启 |
| `ready` | 蓝色更新标识及点 | 当前 → 目标；“点击重启并更新” | 空闲时一次点击进入退出准备并安装 |
| `blocked` | 保留更新标识 | 当前 → 目标；“仍有任务或待确认结果，请处理后更新” | 打开更新详情，说明原因，提供“返回相关会话”和“稍后”；不强停任务 |
| `preparing` | 同位置加载符号、禁用重复点击 | “正在保存并准备重启…” | 无二次操作；成功才进入安装 |
| `installing` | 窗口即将关闭 | 已完成保存与后台退出 | 安装器接管 |
| `error` | 下载曾可见时显示低强调错误标识；仅检查失败则不新增标识 | 目标已知时保留版本变化；具体说明“下载失败，点击重试”等 | 可恢复的网络失败重试；签名/格式失败仅打开详情，不重试安装 |

发现更新与可安装分开。只有在交给 Squirrel 前完成全部候选与包核验，主进程收到 `update-downloaded`，并完成应用自己的退出准备检查后，才能调用 `quitAndInstall()`。普通关闭窗口仍沿用隐藏行为。Squirrel 已暂存的包可能在用户正常退出并下次启动时应用；因此承诺是“不主动重启”，不承诺“只有点标识才会安装”。不能把隐藏 `ready` 或不调用安装 API 当成撤销暂存包。

## 检查与下载

- 默认启动后 30 秒检查一次，避免挤占启动；之后每 6 小时检查，增加 ±10% 抖动。唤醒/恢复网络时，距上次检查超过 1 小时才补一次。菜单手动检查不受该时间限制。
- 检查、下载、手动重试共享一个主进程协调器和一个在途锁。`ready` 或准备安装时不另下一个包。已下载目标在本轮安装/放弃前冻结，浮层与真正安装的目标一致。
- 下载先由主进程落到私有候选缓存，校验后才交给原生 API。界面统一显示不定进度，涵盖下载、校验与原生准备，不伪造百分比。原生 `update-available` 会自动读取包，故它只能收到已核验的本地候选；首版网络中断可重下，不要求实现断点续传。
- 网络失败分别在 5、30、120 分钟后重试，之后每 6 小时一次；休眠不累积补发请求。仅在原生 API 返回终态后解锁。原生检查/下载没有通用取消 API；看门狗只显示“下载暂未完成”，不把超时当成已取消而启动第二次下载。
- 版本使用严格 SemVer 比较；stable 不接收 prerelease、不降级、不重复安装同版本。最低系统版本、CPU 架构或签名身份不匹配的包不进入 `ready`。同版本重新发包不作为升级，发布必须递增版本。
- `currentVersion` 取打包应用的 `app.getVersion()`，构建注入的 UI 版本须与其一致；开发模式显示开发版本，但更新状态为 `unsupported`。

## 更新源与发布

沿用公开仓库 `cubxxw/agentstudio`。发布工作流生成每个受支持架构的 ZIP 和 Squirrel JSON manifest；首版可以只发布 arm64，此时 x64 明确不支持，不回退下载 arm64 包。

固定入口采用 GitHub Releases 的 latest 资产，例如 `https://github.com/cubxxw/agentstudio/releases/latest/download/RELEASES-darwin-arm64.json`。CI 同时把该 manifest 作为版本资产发布。主进程只读取一次候选，验证后冻结目标、架构和哈希，不把可变的网络 feed 直接交给 Squirrel。禁止在 renderer 设置 feed、路径或下载地址。

manifest 的 `currentRelease` 和对应 `updateTo.version/name` 必须是同一个合法版本；`url` 指向本仓库该 tag 的 ZIP，包含发布时间、大小、SHA-256 和最低系统版本。元数据、声明大小、实际下载大小与解包大小均有上限。只接受 HTTPS、明确允许的 GitHub/其 Release 资产重定向域；不得扩大到任意 URL 或把更新元数据当作 HTML 执行。发布说明按纯文本渲染，最多展示有限长度。

暂存前的包核验是强制步骤：下载至本应用私有缓存，用冻结的 SHA-256/大小核对；在隔离目录安全解包（拒绝越界路径、指向目录外的符号链接和超限体积）；核对唯一 `.app` 的 `CFBundleIdentifier`、版本、实际 Mach-O 架构、最低系统、预期 Developer ID/Team ID、完整代码签名和分发验证。所核对内容须与 manifest 和当前应用兼容。任一步失败，清理的仅是本次私有候选，完全不调用原生 updater。

验证通过后，主进程生成只包含该候选的本地固定 Squirrel JSON，把下载 URL 改为已验证的私有 ZIP 的 `file://` URL，再以本地清单 `file://` URL 和 `serverType: "json"` 设置 feed。ZIP 和清单在原生处理期间不改写、不删除，原生签名验证仍然保留。这避免网络 manifest 二次读取时换包；开发时须先用锁定 Electron 45.2.1 跑通本地 feed/ZIP 的真实签名验证，再接入网络候选。若此路径不受该版本支持，则此实现方案验收失败，不启用自动更新，不用未验证网络 feed 代替。

由于原生 API 没有通用“撤销暂存包”，不以下载后拒绝 `ready` 作为版本/兼容性保护。`update-downloaded` 后发现与预先核验结果不一致属于实现故障，停止后续更新动作、保留诊断并阻止发布该构建；首个正式分发必须证明此分支不可能由清单变动触发。首版不提供已暂存版本撤回保证，修复需发布更高版本。

发布顺序：构建并验证架构 → Developer ID 签名（维持 bundle ID/签名身份）→ 公证、staple → 校验 ZIP 和清单 → 草稿 Release 上传全部资产 → 安装回归 → 正式发布为 latest。版本标签和已发布资产不可覆写；发现坏版本发布修复版本，另行撤回 latest 指针。哈希不替代代码签名，公证通过也不证明应用数据升级通过。

生产启用条件同时满足：macOS、packaged、明确的正式分发标识、有效的预期签名身份和已配置的固定更新源。当前 ad-hoc/开发/隔离测试包均为 `unsupported`，测试使用注入的模拟 updater。首个正式签名版本需手动安装，不能假设已有 ad-hoc `.app` 能直接跨签名身份自更新。

## 点击到重启

1. Renderer 同步保存当前会话草稿及待确认请求标识；写入失败就停在原窗口，并显示可重试的原因。记录当前会话 ID/页面，以便重开后恢复。未提交内容不变成自动发送。
2. `install` IPC 带主进程发放的 `updateId`，再次核对就绪包。主进程设置安装锁，拒绝同时切换工作区、重启后台和新原生登录/发送，再要求个人后台暂停调度并冻结新写请求。
3. 等在途写入落盘，并核对所有工作：queued/running/verifying/needs_input/unknown、cancelPending、stopUnconfirmed、requiresReconciliation、原生待核查任务、登录、连接变更。列表不依赖 renderer 快照。不明确的状态按阻塞处理。
4. 有阻塞则撤销本次冻结、恢复调度，返回 `blocked` 和经过脱敏的原因/相关会话 ID。用户处理后再点击；不排队自动重启，不提供默认强制停止。已打开的审批只在原会话里处理。
5. 空闲时创建一致的数据库升级前快照，保存版本与 schema 标识；备份错误则取消安装。备份在原 workspace 的私有目录中，保留 vault/key 的既有归属和权限，不复制到公开安装包或日志。各个人/测试 profile 在首次由新版本打开、迁移前各自备份。
6. 关闭本应用拥有的个人 utility、连接器、登录进程，要求确认退出，不沿用普通退出路径的超时强杀来满足更新。当前 `PersonalHost.stop(true)` 仍会超时强杀，`true` 只检查最终退出，不能直接复用；应新增更新用的无强杀停止方式。未确认退出就阻止安装；若已停掉部分服务，仅恢复本应用可确认拥有的服务，并展示恢复状态，不能把结果未明的任务重发。
7. 全部准备完成才调用一次 `autoUpdater.quitAndInstall()`。更新专用标记允许窗口真正关闭，避免既有 hide-on-close 拦截。`before-quit-for-update` 仅做已准备状态断言和同步收尾；不能在这里才启动异步保存。更新路径和普通 `before-quit` 共用幂等关闭结果，不重复停止/普通 `app.quit()` 抢跑。
8. 新进程从已提交版本读取原 profile、SQLite、连接绑定与草稿，检查后台健康和实际 `app.getVersion()`。仅当实际版本等于目标且工作区启动成功，显示一次短提示“已更新至 0.1.1”，清除旧标识并恢复原会话；不重新创建资料目录或重新登录。

安装意图持久化只含 `updateId`、来源/目标版本、时间和恢复页面引用，不含对话正文、token 或 cookies。若下次仍是旧版本，显示“上次更新未完成”，重新让原生 updater 确认包后才开放重试；磁盘记录不能独立恢复 `ready`。若已是更高版本，则按实际版本完成核对并清理旧意图。

更新后启动或迁移失败时保留备份与唯一证据，提供人工重新安装已知良好版本的说明。首版不承诺自动回滚应用或数据库；回退前必须核对 schema 兼容性，不能让旧程序直接打开已迁移数据。

## 主进程与 IPC 分工

建议主进程 `DesktopUpdater` 管理检查、候选、原生事件和生命周期；`QuitCoordinator` 管理个人后台/原生服务的冻结与退出。更新 UI 只订阅快照。

```ts
type UpdatePhase = "unsupported" | "idle" | "checking" | "upToDate"
  | "downloading" | "ready" | "blocked" | "preparing" | "installing" | "error";
type UpdateSnapshot = {
  phase: UpdatePhase;
  currentVersion: string;
  targetVersion?: string;
  updateId?: string;
  checkedAt?: string;
  reason?: string; // bounded user-facing code/message, never raw errors or URLs
};
// Dedicated, trusted-personal-renderer IPC. Exact names may follow repo conventions.
updates.getState(): Promise<UpdateSnapshot>;
updates.onChanged(listener: (state: UpdateSnapshot) => void): () => void;
updates.check(): Promise<UpdateSnapshot>;
updates.install(updateId: string): Promise<UpdateSnapshot>;
```

所有命令验证主窗口、主 frame、当前可信文档和工作区状态；新状态只发给受信 renderer。限制参数长度、合并请求、清理订阅。`install` 的返回是“已进入准备/受阻/失败”，不是升级成功回执。升级成功由新进程读回实际版本确认。现有 `restart` 和 Matrix IPC 不因此扩大权限。

## 实现任务与验收

实现建议按两步交付：先做协调器、IPC、入口和合成状态验收；随后建立正式签名分发链并跑两个真实版本间的安装。设计 PR 完成不代表第二步已完成。

| 范围 | 必须验证 |
| --- | --- |
| 状态逻辑 | SemVer 大小/非法值、prerelease、同版本、单次检查锁、重复点击、事件晚到/乱序、ready 目标冻结、断网重试、原生 API 未结束时不重复下载 |
| IPC/来源 | 非主 frame/非可信文档被拒、renderer 不能传 URL、过期 updateId、恶意或超大清单、非本仓库地址、哈希/签名/架构/最低系统不符 |
| 浏览器合成 UI | 每个状态、悬浮/聚焦版本变化、Escape、hover 浮层可达、深浅色、缩小窗口、减少动态、高对比度；`ready` 点击一次、`downloading` 不重启 |
| 原生合成流程 | `before-quit-for-update` 与已有退出不冲突；有 CLI/审批/未知任务/登录时不退出；冻结期间新消息/调度不被接受；草稿失败/备份失败/停止失败均留在应用并可恢复 |
| 真实分发 | 已签名版本 A 安装到 B，实际版本/哈希/签名读回，原资料/草稿/连接保留，断网、只读安装位置、睡眠恢复、更新失败后可重新打开，按已发布架构分别验收 |

拟新增 test IDs：`im-update`、`im-update-tooltip`、`im-update-current`、`im-update-target`、`update-panel`、`update-check`、`update-install`、`update-error`、`update-blockers`。实现时一并写入 `docs/clients.md`。浏览器或模拟 updater 的成功只证明对应交互；真实签名升级、私有账号连续性、VoiceOver 必须单独记录。

## 技术依据

- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)：原生下载事件、签名要求、重复检查语义、安装调用时机及退出顺序；同时核对了仓库锁定的 Electron 45.2.1 类型声明。
- [Electron 更新指南](https://www.electronjs.org/docs/latest/tutorial/updates)：Squirrel 静态 JSON manifest 与按平台/架构发布的格式。实现前须以所锁定 Electron 版本再验证清单字段及签名行为。

本轮交付为设计文档和无副作用的 HTML 示意，不修改应用源码、包依赖或安装。本页没有把设计验收当作自动更新上线验收。
