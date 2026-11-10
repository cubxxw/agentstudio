# Muse 登录加载修复（GET-482）

用户的真实登录页出现过邮箱已填但 Continue 不可用。系统浏览器中同一账号能正常进入 Muse。修复保留已有账号、独立分区、任务与凭据，不导入浏览器 Cookie，不更换账号。

## 可核对的根因

在 Electron 45.2.1 的真实公开页面中，初始 HTML 已能显示邮箱表单，但客户端脚本未准备好；此时输入框语法校验有效，Continue 仍 disabled。等待控件就绪后，相同输入可以进入正常发送验证码的流程。

仅等待整个页面加载也不正确。对同一个隐藏窗口的观测记录了：页面仍 `interactive`、Continue 已 enabled、完整 `loadURL` 尚未结束、仍有 6 个资源请求。显示/聚焦的对照尚未发生，因此不能把隐藏本身称为根因。固定版本 [Electron 源码](https://github.com/electron/electron/blob/v45.2.1/lib/browser/api/web-contents.ts#L39-L57) 还显示 `executeJavaScriptInIsolatedWorld` 会等 `did-stop-loading`；旧登录检测也被这个门槛拖住。

此外，旧 `signIn` 在注册取消和 `finally` 之前等待 `loadURL`。独立假窗口复现了加载卡住时取消不能及时关闭、取消前已失效仍新建窗口的问题。

## 最终行为

- 连接页区分“正在载入登录页”和“等待账号验证”。初始表单不提前接受输入。
- Muse 使用官方 `mainFrame.executeJavaScript` 检查公开控件的两个布尔状态；就绪或已登录不再依赖所有图片/视频完成。表达式不读取输入值，不回传验证码、账号名称或对话正文。聊天驱动保持原来的隔离执行。
- 加载阶段最多 90 秒；控件就绪后不会用该时限催促用户输入验证码。取消与关闭可以打断挂起的导航或检测，清理该次登录与弹窗。
- 就绪后的正常跳转 `ERR_ABORTED` 保留登录；其他加载错误仍报告失败。认证成功后的后台网页加载不再阻塞登录回执，失败进入可恢复状态，不产生未处理拒绝。

## 验证范围

新增假窗口测试记录了旧版 1/11 通过、修复版 11/11 通过；进一步增加就绪早于完整加载和正常跳转两项，旧冻结版 11/13、新版 13/13。完整桌面测试为 103/103，类型检查通过。测试与真实网页验证分别记录。

真实原生公开页面验收第二轮 `muse-real-um85mY` 通过 7 项：加载阶段不暴露未就绪表单、窗口来自官方 Muse、显示时 Continue 可用、取消关闭自有窗口、不产生连接/任务/历史导入、无 renderer 异常。它没有提交账号或验证码，因此不代表私人账号已登录。

首轮把完整导航作为显示门槛，在真实冷启动中超时；该失败保留为 `muse-real-Aar1jb`，由上述同窗观测定位第二层等待，未改写成首轮全过。`backgroundThrottling:false` 与后台窗口保持一致，但未将其单独称为 Continue 修复的证据。

复现：先构建桌面，再设置 `AGENTSTUDIO_ELECTRON_BINARY` 或 `AGENTSTUDIO_PACKAGED_APP`，运行 `node dev/personal-muse-login.mjs --real`。脚本使用隔离 profile、官方公开页面，不提交邮箱/验证码、不调用模型。原始证据在本机注册目录 `ai-test-get-482-muse-login.fnjNtH`。PR/CI、最终安装及真实账号状态另记 `/Users/cubxxw/data/agentstudio-references/get482-delivery/README.md`。
