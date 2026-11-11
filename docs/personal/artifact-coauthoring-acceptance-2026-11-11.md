# 多 Agent 共创验收记录（2026-11-11）

群聊提案、一次批准、Codex/Pi 各自文件贡献、隔离预览、第二群修改同一作品、固定旧版本和独立库重开已经跑通。下面分别记录原生合成流程、真实模型、自动检查与交付状态。

## 已观察的结果

| 检查 | 结果 |
| --- | --- |
| 个人后端完整回归 | 210 passed，1 optional native-Pi skip；包含旧数据库迁移、撤权、历史来源、Finder 二进制文件和恢复 |
| 桌面完整单元测试 | 156 passed（含合入主分支的窗口/导航测试） |
| Core | 99 passed，1 integration skip |
| 原生注册/stack | 14 passed |
| 个人、桌面 node/web/smoke 类型检查与构建 | 通过 |
| 最新原生合成主流程 | 9 个检查点通过，`synthetic-30PkSJ/acceptance.json` |
| 原生运行错误负例 | 5 个检查点通过，`synthetic-zwmZKL/acceptance.json`；错误详情仅所有者可见 |
| 旧聊天设置界面回归 | 8 个检查点通过，`agent-profile-ui-final/` |
| CI | `3767e1b` 的 Go 与 TypeScript 完整 CI 通过；最终交付门禁以 PR 当前提交检查页为准，不能从本机结果推断远端状态 |

正式证据根为 `/private/tmp/ai-test-artifact-coauthoring.cpLUvJ`。最终检查日志与决策 ledger 归档到其 `implementation-evidence/`。所有验收使用独立 profile 与合成阅读产品需求，没有使用真实业务资料或第三方聊天内容。

原生预览已验证：没有 `agentStudioPersonal`，访问父窗口 DOM 被拒绝，本机网络哨兵收到 0 次请求，脚本按钮可交互。主进程在 1280/390 两档运行实际页面检查；抛错负例保存了版本，但没有交付或标记 completed。中间工作版本不替换 Finder 或群共享。

## 真实 Codex / Pi

- Codex 0.163.0，`openai / gpt-6.1-sol / xhigh`。
- Pi 0.85.1，用户明确要求改为 `deepseek / deepseek-flash`（本机模型名 DeepSeek V4.1 Flash），保留 high。原配置备份在本机 Pi 私有目录，没有导出凭据。真实工具探针通过于 `deepseek-flash-probe-verified/native-tools.json`。
- 最终真实流程：`real-4PfCAv/acceptance.json`，状态 passed，renderer errors 为空。
- 持久作品：`aw_c4c621cf-b9ba-4ed1-9f4d-5a349ce113d6`。
- 首轮版本：`rev_0e48e1b2-36ce-4f97-a5e9-fd063cda235c`。
- 第二群版本：`rev_fdcd3cdf-c0a6-4e90-96a0-bb3ae95a6f92`。
- 第二群 Pi 的已整合贡献来自 `run_ca1d70a5-352a-4097-8dfd-18f8e870eb62`；Codex 来自 `run_a29d8e6f-79ff-48f0-bc8a-ed59c519ef2f`。报告核对了两者各自的真实工具回执、不可变文件和接受时的模型快照。

这是保留状态后续跑的真实验收。首轮两位实际回复、共同卡片和贡献在最终权限修复前完成；第二群在修复后的构建继续，最后核查跨群新版本、第一群固定版本、作品库重开和窄屏。它不能被表述成“最终提交从空 profile 一次无失败跑通”。最新构建从空 profile 的确定性原生合成流程单独通过。

失败和处理均保留：最初 MiMo 认证拒绝；DeepSeek 曾把负责的 Markdown 文件误当成整件网站的类型，工具现支持按方案 ID/版本加入；一次循环依赖经所有者审核改为 Pi → Codex。第二群 Pi 的最终群聊回复格式曾被拒绝，没有被发布，已保存的双人原生提案仍经所有者批准。随后 Pi 事件流超过原捕获额度；现按官方 JSON 事件结构逐行处理重复轮次/工具记录，只保留最后助手结果与 settled，最终文本/单行默认仍限 2 MB、总传输 16 MB。先复现后修复，并通过所有者私有详情重试已确认结束的步骤，最终两位均真实提交。旧报告和失败截图保存为 `acceptance.previous-*.json` / `failure.previous-*.png`。

## 独立审查与修复

一次全分支独立审查（fresh gpt-6-astra xhigh，`ae19ed3..dfa3a7d`）发现 12 个 Important 问题，统一修复并跑完整回归，没有以第二次审查代替测试。

| 问题 | 修复与证据 |
| --- | --- |
| 未批准 head、移除后重新加入、后来的共享选择 | 工作只使用批准 base/本轮产生版本；受众永久收窄；最新所有者共享优先 |
| 撤回来源仍可继续、follow 可读祖先/候选、缓存元数据 | 撤回会停止依赖工作并撤会话；follow 仅已交付后代；缓存重放重查权限 |
| 工作额外资料泄露给无关群成员 | 只给本轮获准参与者和所有者，成果同步收窄；群共享另行决定 |
| 工作自由文本、历史内容和流式输出泄露 | 群卡只投影固定状态；私有 owner detail；完整受众/来源重检；关闭群流式文本 |
| 完整候选文件/目录、大小写或 Unicode 冲突 | 同卷私有验证树先于 head CAS，检查策略绑定 v2 |
| Finder 二进制元数据使保存/恢复失败 | 原始文件流式指纹与严格 UTF-8 导入分开，完整旧树备份，详情立即检测 |
| queued 重启丢调度、unknown 无恢复、丢失 owner 回执 | 安全重排队、私有核查/放弃、按不可变贡献恢复回执、协调后继续原工作 |
| 另一群绕过停止未确认、正常取消变 blocked | 普通/共创统一执行器保护；确认取消保持 cancelled |
| 群卡误开最新 head | URL/回调携带确定 revision；第一群卡在第二群修改后仍打开首轮版本 |
| 批准附件只剩名称 | 冻结 ID/名称/SHA；提供准确已核验原字节；后群不继承原附件 |
| 网页检查前覆盖 Finder/群版本、页面可干扰检查 | 私有工作 head，原生通过后再投影/交付；独立 JS world |
| 回执/缓存重复大文本、全局扫描读取历史 | 不可变对象引用、丢弃已返回的大文本 Promise、按群索引/有界状态回执 |

预览超时后孤儿窗口和检查所有权竞态由 Minor 升为 Important，已用独立取消域/窗口修复并有 RED→GREEN 测试。另补了索引迁移中断与旧记录回填的 RED→GREEN。详细失败与通过日志、完整决策列表保存在证据归档。

唯一 deferred minor：`collaboration_status` 返回 `id`，说明文字使用 `proposalId`；版本化加入已可用，字段别名一致性留待后续。

## 交付边界

支持文档和无构建依赖的静态 HTML/CSS/JS；远端人类身份/消息网络、依赖安装、任意 shell、常驻服务、生产部署和分发不在本版。这里的应用授权不等于同 OS 对手隔离或任意 CLI 扩展安全沙箱。自动预览不代表全交互、无障碍或真实后端通过；用户接受版本仍需明确选择。

PR：[#18](https://github.com/cubxxw/agentstudio/pull/18)。Linear MCP 持续返回工具不可用，已登录的原生工作区仍停在加载页，尚未建立 issue 关联；不能据此声称 Linear 已完成。本机 GitHub CLI 对主仓库为 READ；连接器不可用，网页扩展与原生 Chrome 控制均超时，未能核实另一具备合并权限的网页登录。PR 保留待合并。独立 worktree、真实作品、历史失败和唯一证据保留，未写入用户的日常 profile。
