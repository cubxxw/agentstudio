# Personal Messenger Implementation Plan

**Goal:** 联系人、私聊、群聊和统一审批在现有 Mac 应用内形成完整链路。
**Architecture:** React 消息主页 + 固定 IPC + SQLite 联系人/群成员/身份快照，复用既有队列、恢复、凭据和审批执行引擎。
**Tech Stack:** React 19 / TypeScript / Electron / Node SQLite，复用现有依赖。
**Spec:** `docs/superpowers/specs/2026-11-10-messenger-design.md`

## Global constraints

用户已授权自主产品裁决、实现、审查、PR、CI 和门禁通过后合并。不另起 Matrix，不导入其他工作区，不移植 Raft 源码。旧数据兼容；未接通的人类联系人不能显示送达。

## Review focus

1. 同 handle 不同身份、中文提及边界及非成员提及。
2. 后端身份更新/群加人不能改变已接受 run 或泄露入群前记录。
3. 网络丢失后重发不能重复建联系人、消息、run 或审批动作。
4. 单个 Agent 等待审批/失败不能阻塞其他可独立处理的成员。
5. UI 切换/重载/异步旧回包不能覆盖别的会话草稿或内容。

## Task 1: 联系人和聊天协议

- [x] 新建 `apps/personal/server/messenger.test.mjs`：持久联系人、DM 唯一、群响应、身份快照和审批端到端。
- [x] 新建 `server/messenger.mjs`：联系人同步/验证、建群、成员、响应目标、消息接受和审批投影。`index.mjs` 添加固定路由；`store.mjs` 保留消息归属并快照 run 身份；`runtime.mjs` 注入身份与可见上下文，不自动改派联系人。
- [x] 更新 TypeScript 类型、Electron IPC allowlist、build copy/hash 列表，运行后端和 desktop contract 测试。

## Task 2: Telegram 风格主页

- [x] 新建 `src/Messenger.tsx`、`src/messenger.css`，作为两个个人入口的默认 App；复用原 Modal/Reader/Preferences/DecisionView。
- [x] 联系人搜索/发现/创建/编辑、聊天列表/气泡/草稿/附件/回复、群创建/成员/策略、审批中心/返回原聊。
- [x] 运行 personal/desktop typecheck、build；以隔离浏览器和 Electron 验证真实 UI。

## Task 3: 审查和交付

- [x] 独立 Agent review，修复确认的高优先级问题并针对复测。
- [ ] 更新 API/架构/客户端/产品文档与验收账本。提交、创建关联 Linear 的 PR，检查最新适用 CI，通过后合并，按实际验收状态更新 issue。
