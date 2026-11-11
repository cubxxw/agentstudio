# GET-495 自动更新设计检查

2026-11-11 · [Linear GET-495](https://linear.app/getyak/issue/GET-495/design-macos-automatic-updates-with-a-restart-indicator)。本页检查[设计](../superpowers/specs/2026-11-11-macos-auto-update-design.md)和[独立 HTML 预览](macos-update-preview.html)，不作为应用自动更新已经实现或正式发布的证据。

## 本轮结果

- 在隔离 Chrome 中完成 19 项交互检查，均通过，未捕获页面异常。
- 覆盖当前/目标版本、悬浮及指针移入浮层、离开关闭、键盘聚焦、Escape 及焦点保留、就绪后点击进入准备、取消准备、下载中仅查看进度、任务阻塞重启、弹层焦点循环和恢复、失败重试、无更新隐藏标识、深色外观、窄窗浮层边界与无横向溢出、减少动态。
- 保存浅色就绪、深色就绪、任务阻塞和 420px 窄窗截图，并人工查看浅色与窄窗画面。预览没有安装、下载或重启能力；只有 localhost 页面资源请求。
- 独立 Electron/macOS 工程审阅发现原生更新器的暂存包可能在下次启动时应用，因此只在下载后拒绝 `ready` 无法撤销包。设计改为在交给 Squirrel 前下载和核验完整候选，并使用固定的本地 feed/ZIP；不支持时禁止启用。另明确当前 `stop(true)` 仍会强杀，更新必须新增无强杀关闭方式。复审结果为无重要未决问题。
- `git diff --check` 通过。未运行应用构建、整栈测试或签名打包：本 PR 只包含设计、链接和无副作用的预览。

## 证据与边界

本机注册产物：`ai-test-macos-update-design.NqZkaG`。可分享的预览、四张截图与检查摘要另存于本轮 Codex visualization 目录，临时浏览器与 HTTP 服务仅供本次检查。

以下仍需实现及独立验收：原生 updater/IPC、退出协调器、真实候选核验与本地 feed/ZIP 的 Electron 45.2.1 可行性、正式 Developer ID 签名/公证/发布、两个真实版本间的升级与数据连续性、VoiceOver。合成 HTML 检查不覆盖这些能力。
