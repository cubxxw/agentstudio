# Muse Library / Spaces：本机客户端观察

日期：2026-11-11。范围是用户已安装的 Muse 客户端公开界面与随应用分发的静态前端。未复制实现，不导出私人作品、聊天、Cookie、凭据或服务端数据。

## 实际观察

通过原生应用的可访问性树，Library 有独立搜索和分类导航：Files 下有 Spaces / Documents，Media 下有 Images / Videos / Podcasts，另有 System files。Spaces 列表有排序、选择和创建入口。

打开一个既有 Space 后，地址从 `/library/artifacts` 进入 `/library/artifacts/:slug`。作品框架提供标题、菜单、关闭和并排聊天入口；本次作品正文一直处于加载状态，菜单没有成功展开。因此不能由本次观察声称已验证编辑、分享、版本恢复、权限模型或作品运行。

Chrome 扩展控制通道超时，随后使用已经运行的 Muse 原生应用完成上述导航。没有创建或修改 Muse 资源。

## 静态客户端佐证

本机 Muse 11.1 / build 1109246656（`com.meta.endo`）的 `/Applications/Muse.app/Contents/Resources/hatch/index.html` 是随应用分发的内联前端，读到约 45.3 MB。观察时 SHA-256：

`309ba1eb17d775f951f6bbabb72caf4db2212b18b9c6bf0023ffad67289e7095`

有界符号检查发现：

- 路由分别覆盖 Library 列表、作品详情、文档、媒体、文件与聊天。
- 列表文案按 web / documents 类型，以及 Spaces 展示开关区分；界面文案中的 Space 与 Artifact 不是由此可以证明的两个不同存储实体。
- 存在作品侧栏、独立舞台和恢复并排聊天的前端结构。
- 私有作品路由使用不透明句柄的客户端辅助结构，但观察不足以推断服务端授权；不把路由隐藏当作权限控制。

没有保存或移植原始客户端源码。静态分支存在不代表当前账号启用了相应功能。

## 在 AgentRoom 中的独立设计

采用独立作品库、作品详情与并排聊天；以内容类型选择展示方式。作品身份、权限、版本与创作运行由 AgentRoom 自己建模。多 Agent 分工、授权卡、跨群聊访问与冲突处理均是本项目的新设计，不归因于 Muse。

官方背景：[Muse 运行环境](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)。其中描述了独立运行环境和工作区，不建立本机目录可被 Muse 直接访问的假设。

## 其他参考

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)：作为工具客户端连接外部 MCP。不要把已移除的 Codex MCP server 当作接入路线。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：原生工具请求、事件和审批的另一条路线，动态工具仍有实验性要求；首版不将其作为唯一依赖。
- [Pi 扩展](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)：可信扩展注册模型可调用工具。实际安装的 Pi 0.85.1 文档也提供显式扩展和关闭自动发现的组合。
- [A2A 版本关联](https://a2a-protocol.org/v0.3.0/topics/life-of-a-task/#tracking-artifact-mutation)：客户端维护迭代产物之间的版本关系。

以上只用于机制选择；不宣称不同服务共享同一个文件系统，也不据客户端代码推断未观察的服务端行为。
