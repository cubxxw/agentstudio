# 多 Agent 共创验收记录（2026-11-11）

本记录区分实现、合成原生流程、真实模型、用户接受和 CI/合并。真实模型完整闭环仍在验证，不能用合成通过代替。

## 已观察的结果

- 原生 Electron 45.2.1 合成闭环通过：两位独立回复、一张共同方案卡、拒绝不创建内容、调整后审核新版本、一次同意后两位分别提交、隔离脚本预览、第二群继续修改同一 `aw_…`、5 个历史版本、重载和窄屏。
- 原生隔离验证：预览不存在 `agentStudioPersonal`；访问父窗口 DOM 被拒绝；对本机网络哨兵的 fetch 被 CSP 拒绝，哨兵收到 0 次请求。
- 实际页面抛错的负例通过：文件和版本已经保存，但宿主隐藏窗口发现运行错误，最终状态为 blocked，未标 completed。1280/390 两档页面检查由主进程执行，模型和 renderer 不能自行报告通过。
- 后端覆盖内容哈希、版本 CAS、同文件冲突、brief 指纹改变、局部共享、固定版本、缓存撤权、移除/重新加入成员、绑定改变、权限等待/拒绝恢复、单槽派工/让出、崩溃恢复和保留 Finder 修改。
- 现有个人后端完整回归曾达到 176 passed、1 optional native-Pi skip；最后修复后的全量检查及当前提交证据将在交付前补齐。

本机正式证据根：`/private/tmp/ai-test-artifact-coauthoring.cpLUvJ`。合成主流程：`synthetic-bEE15T/acceptance.json`、截图；原生运行错误负例：`synthetic-jy7Qto/acceptance.json`。证据归属于隔离 profile，未使用真实业务资料或第三方会话。

## 真实 Codex / Pi

最初的真实运行中，Codex 0.163.0 / gpt-6.1-sol / xhigh 实际调用了 `artifact_list`、`collaboration_status` 和 `creation_propose` 并回复；Pi 的原 MiMo 提供商拒绝认证，所以没有批准或假称完成双 Agent 创作。

用户随后明确要求把 Pi 改成 DeepSeek Flash。已保存 Pi 默认值 `deepseek / deepseek-flash`（本机目录名 DeepSeek V4.1 Flash），保留 high 思考级别；原设置备份保存在本机私有配置目录，没有导出凭据。Pi 0.85.1 的真实原生工具探针在此模型通过，返回实际工具值 `AGENTROOM_PI_REAL_TOOL_OK`。证据为 `deepseek-flash-probe-verified/native-tools.json`。

第一轮双 Agent 讨论在 DeepSeek 下均已真实回复；Pi 的原生提案把负责的 Markdown 文件误当作整件作品的类型，因而遭到正确拒绝。保留了 `real-gDF3rs`。已依据这一结果改进工具：`creation_update` 可按方案 ID/版本加入分工，不必重填作品类型；冲突返回明确的整体类型与加入方式，schema 和提示词也明确 Markdown 可以属于网站。对应回归先失败后通过。修复后的完整真实共创正在独立 profile 中重跑。

机器负载曾使真实 Pi `--help` 超过 2.5 秒，被误当成能力不足；已用 3 秒帮助探针复现，并把默认探测上限改为 5 秒（仍有硬上限）。没有因此升级 CLI、替换模型或放开工具权限。

## 交付与限制

- 支持文档和无构建依赖的静态 HTML/CSS/JS；未提供依赖安装、任意 shell、服务运行、生产部署或跨设备人类消息网络。
- 自动检查不等于全交互、无障碍、真实后端、设备或发布验收。用户接受版本仍需在界面明确选择。
- PR：[#18](https://github.com/cubxxw/agentstudio/pull/18)。独立代码审查、当前提交 CI 和最终真实结果按实际完成情况更新。
- Linear 插件持续报告工具不可用；本机已登录的工作区刷新后仍停留在加载页，尚未建立 issue 关联。此状态不等于任务已在 Linear 完成。
