# 联系人驱动的个人 IM

用户本轮明确改变原 GET-476 的任务优先方向：主页以 IM 为中心，联系人可包含人和 Agent，先完整支持本人和自己的 Agent 的私聊、群聊与统一审批。以本轮要求为准；既有任务、消息、成果、审批和凭据保留。

## 产品与方案

选择在现有 macOS 个人工作区增加持久联系人与聊天模型，复用 SQLite、单工作者、本机 Codex/Claude 和已连接 A2A/MCP。另起 Matrix 栈会强加多进程和账号迁移；仅改任务列表样式不能实现身份和群响应。两者均不适合这次个人 Agent 优先的交付。

Telegram 风格：系统字体、蓝色强调、实色背景、窄导航轨、密集但有呼吸的头像会话行、入站浅白/出站浅蓝消息、固定底部输入。聊天/联系人/审批三个入口；设置保留现有连接和显式记忆。空库展示真实本机发现与开始聊天入口，不放虚构聊天或在线人数。窄窗单列和返回；保留 macOS 交通灯和拖动区。键盘、中文输入、减少动态效果、暗色与草稿恢复均可用。

## 数据和响应

- Contact：持久 `id`、唯一 `handle`、`kind: agent|human`、名称、说明、身份指令、头像色、revision、绑定 `localAgentId` 或 `connectionId`。身份是用户定义的角色，不是服务账号验证。自动同步已发现 CLI 和已有远端连接；未支持的 CLI 如实显示不可执行。用户可基于可用后端创建多个不同身份。
- 所有人拥有本机唯一 `self`。人类联系人先是本地通讯录，明确标示尚无网络投递；不能显示送达或冒充远端人类。未来可接网络身份。
- Thread 新增 `kind: direct|group`、`memberIds`、群内策略；老 thread 原样保留。DM 以联系人 ID 复用，空会话创建不启动模型。群允许本人加一个或多个联系人；增加成员只影响之后接受的运行，不自动重发历史。
- 用户消息只保存一次；按群策略为目标 Agent 分别建立顺序 run。私聊默认回应；群默认 mention；可改为 always 或 manual。提及使用唯一 handle 精确匹配，不允许不存在/非成员触发。`@all` 仅当前可执行成员；assistant 输出不触发新 run，无机器人循环。
- 每个 run 在接收时快照身份、绑定、可见消息范围、成员和策略，后续修改不会改写已接受任务。只有入群后的内容进入其上下文；显式回复同一 Agent 的旧消息也可唤起它。已提交未知副作用仍阻止自动重放。
- Agent 本地聊天不自动改派其他服务；远端发送/工具调用仍走原有具体预览与 version/clientId 审批，保留凭据身份绑定。群审批不能改派别的成员，也不能把批准当执行成功。
- GET `/api/approvals` 返回所有会话的待审和历史决策及原会话引用；集中入口复用现有 `/api/decisions/:id`，不加一键全批。原会话也显示同一审批卡。
- 固定桌面 IPC 只增加明确路由，不允许任意 URL/命令。新后端模块必须被 Electron 构建复制并计入 provenance。

## 研究证据

Raft 发布镜像 `db5e399f017d584e49597e3a28757645d6807893`，2026-11-10 读回 GitHub 元数据以及固定版本 dm/profile/mention 手册。DM 文档说明 reuse 和 peer-card；profile 文档区分身份和状态；mention 文档区分 membership、passive delivery、directed attention，群内 ambient chatter 倾向安静。手册说明现有 DM 加人 UI 有限制；不照搬此限制。原有源码观察另见 `docs/personal/research/raft-observation.md`。FSL-1.1-ALv2：仅研究行为，所有实现独立编写，无源代码移植。

参考官方文档：[Telegram Bot Features](https://core.telegram.org/bots/features) 的群隐私、机器人身份和消息内交互；[Signal Group chats](https://support.signal.org/hc/en-us/articles/360007319331-Group-chats) 的选联系人→命名→建群；[Slackbot](https://slack.com/help/articles/202026038-How-to-work-with-Slackbot) 的可见上下文范围和明确共享写入确认。采用 Telegram 的导航和消息层次、Signal 的简单建群、Raft 的身份和注意力机制，不引入 Slack 频道工作台。

## 验收

隔离 SQLite/假 CLI/合成远端验证发现、身份持久化、DM 复用、仅提及和多 Agent、身份快照、入群可见边界、唯一消息和幂等、审批拒绝/重放/旧版本、未知结果恢复。浏览器和真实 Electron 分别验证联系人→私聊→改身份→建群→提及→审批→回原会话、键盘/窄窗/暗色/重载草稿。实际本机 CLI、私人远端账号、模型额度和跨设备多人各自标明证据；不把合成验收当真实第三方连接。
