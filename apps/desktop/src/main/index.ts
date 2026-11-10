// Electron main process for AgentStudio Desktop (macOS first).
//
// Security: the renderer runs with contextIsolation, sandbox and no Node
// integration; it reaches the OS only through the preload's narrow API. The
// renderer is bundled locally and served from file:// (dev: the Vite server).
// A strict CSP limits network access to the configured server origin.

import { existsSync, mkdirSync } from "node:fs";
import { delimiter, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { buildCsp, isExternalUrlAllowed, normalizeServerUrl, resolveServerUrl } from "../shared/config";
import { IPC, type DesktopInfo } from "../shared/desktop-api";
import { isAgentNotifyMode } from "../shared/notifications";
import { DesktopNotifier } from "./notifications";
import { DesktopStorage } from "./storage";
import { ConnectorManager, connectorsEnvFromProcess } from "./connectors/manager";
import { buildDiagnostics, writeDiagnostics } from "./diagnostics";
import appIcon from "../../resources/icon.png?asset";
import { PersonalHost } from "./personal-host";
import { PERSONAL_IPC, isTrustedDocument, personalCsp, type PersonalCommand } from "../shared/personal-api";

declare const __APP_VERSION__: string;
declare const __APP_REVISION__: string;

// ---- profile isolation (must happen before "ready") ----------------------------

const userDataDir = process.env.AGENTSTUDIO_USER_DATA_DIR;
if (userDataDir) {
  mkdirSync(userDataDir, { recursive: true });
  app.setPath("userData", userDataDir);
}
// Tests can avoid touching the real login keychain (safeStorage then uses a mock key).
if (process.env.AGENTSTUDIO_MOCK_KEYCHAIN === "1") app.commandLine.appendSwitch("use-mock-keychain");

// The app's name picks its data folder and its keychain item ("AgentStudio Safe Storage").
app.setName("AgentStudio");
if (!userDataDir) app.setPath("userData", join(app.getPath("appData"), "AgentStudio"));

const personalMode = process.env.AGENTSTUDIO_WORKSPACE !== "matrix";
const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererHtml = join(__dirname, personalMode ? "../renderer/personal/index.html" : "../renderer/index.html");
const rendererFileUrl = pathToFileURL(rendererHtml).href;
const rendererDocumentUrl = devServerUrl ? new URL(personalMode ? "personal/index.html" : "index.html", `${devServerUrl.replace(/\/+$/, "")}/`).href : rendererFileUrl;

let storage: DesktopStorage;
let connectors: ConnectorManager;
let notifier: DesktopNotifier;
let mainWindow: BrowserWindow | null = null;
let windowShown = false;
let quitting = false;
let personalHost: PersonalHost | undefined;
let shutdownPromise: Promise<void> | undefined;
let shutdownComplete = false;

function serverUrl(): string {
  return resolveServerUrl(process.env.AGENTSTUDIO_SERVER_URL, storage.readSettings().serverUrl);
}

/** Only our own renderer document may use the IPC API. */
function fromRenderer(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !personalMode && fromOwnFrame(e);
}

function fromOwnFrame(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !quitting && !!mainWindow && e.sender === mainWindow.webContents && e.senderFrame === mainWindow.webContents.mainFrame &&
    isTrustedDocument(e.senderFrame.url, rendererDocumentUrl);
}

function fromPersonal(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return personalMode && fromOwnFrame(e);
}

function isOwnUrl(url: string): boolean {
  return isTrustedDocument(url, rendererDocumentUrl);
}

function documentCsp(): string { return personalMode ? personalCsp(devServerUrl) : buildCsp(serverUrl(), devServerUrl); }

// ---- CSP ---------------------------------------------------------------------------

function installCsp() {
  if (devServerUrl) {
    // Dev: the renderer comes from the Vite server over http; add the header there.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      if (isOwnUrl(details.url) && details.resourceType === "mainFrame") {
        headers["Content-Security-Policy"] = [documentCsp()];
      }
      callback({ responseHeaders: headers });
    });
    return;
  }
  // Production: intercept file:// so the HTML document carries a CSP header.
  // Only files inside the bundled renderer directory are served.
  const rendererDir = resolve(__dirname, "../renderer");
  protocol.handle("file", async (request) => {
    let filename: string;
    try { filename = resolve(fileURLToPath(request.url)); } catch { return new Response("Not found", { status: 404 }); }
    if (!filename.startsWith(`${rendererDir}${sep}`)) return new Response("Not found", { status: 404 });
    const res = await net.fetch(request, { bypassCustomProtocolHandlers: true });
    const headers = new Headers(res.headers);
    if (request.url.split(/[?#]/)[0]!.endsWith(".html")) {
      headers.set("Content-Security-Policy", documentCsp());
      headers.set("Content-Type", "text/html; charset=utf-8");
    }
    return new Response(res.body, { status: res.status, headers });
  });
}

// ---- window -------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: "AgentStudio",
    icon: appIcon, // Windows and Linux; macOS uses the Dock icon below
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f5f5f7",
    webPreferences: {
      preload: join(__dirname, personalMode ? "../preload/personal.js" : "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  mainWindow = win;

  windowShown = false;
  win.once("ready-to-show", () => {
    windowShown = true;
    win.show();
  });
  // On macOS closing the window only hides it: the app keeps syncing in the
  // background, so notifications and the Dock badge keep working.
  win.on("close", (e) => {
    if (process.platform !== "darwin" || quitting) return;
    e.preventDefault();
    // A full-screen window would leave an empty Space behind; leave full screen first.
    if (win.isFullScreen()) {
      win.once("leave-full-screen", () => win.hide());
      win.setFullScreen(false);
    } else win.hide();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // No in-app popups: external links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isOwnUrl(url)) return;
    e.preventDefault();
    if (isExternalUrlAllowed(url)) void shell.openExternal(url);
  });
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());

  if (devServerUrl) void win.loadURL(rendererDocumentUrl);
  else void win.loadFile(rendererHtml);
}

function focusWindow() {
  if (!mainWindow) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// ---- IPC ----------------------------------------------------------------------------

function registerIpc() {
  ipcMain.on(IPC.info, (e) => {
    if (!fromRenderer(e)) {
      e.returnValue = null;
      return;
    }
    const info: DesktopInfo = {
      version: __APP_VERSION__,
      platform: process.platform,
      serverUrl: serverUrl(),
      serverUrlFromEnv: !!process.env.AGENTSTUDIO_SERVER_URL,
      emailSignInOnly: process.env.AGENTSTUDIO_EMAIL_SIGNIN === "1",
    };
    e.returnValue = info;
  });

  ipcMain.handle(IPC.setServerUrl, (e, url: unknown) => {
    if (!fromRenderer(e) || typeof url !== "string") throw new Error("forbidden");
    const normalized = normalizeServerUrl(url);
    storage.writeSettings({ ...storage.readSettings(), serverUrl: normalized });
    // The CSP is computed per document load, so reload to apply the new origin.
    setTimeout(() => mainWindow?.webContents.reload(), 50);
  });

  ipcMain.handle(IPC.sessionLoad, (e) => {
    if (!fromRenderer(e)) throw new Error("forbidden");
    return storage.loadSession();
  });
  ipcMain.handle(IPC.sessionSave, (e, s: unknown) => {
    if (!fromRenderer(e) || !s || typeof s !== "object") throw new Error("forbidden");
    storage.saveSession(s);
  });
  ipcMain.handle(IPC.sessionClear, (e) => {
    if (!fromRenderer(e)) throw new Error("forbidden");
    storage.clearSession();
  });

  ipcMain.on(IPC.notify, (e, input: unknown) => {
    if (fromRenderer(e)) notifier.show(input);
  });
  ipcMain.on(IPC.badge, (e, count: unknown) => {
    if (fromRenderer(e)) notifier.setBadge(count);
  });
  ipcMain.handle(IPC.notifyTakeClick, (e) => (fromRenderer(e) ? notifier.takeClick() : null));
  ipcMain.handle(IPC.notifyPrefs, async (e, op: unknown, a?: unknown, b?: unknown) => {
    if (!fromRenderer(e)) throw new Error("forbidden");
    switch (op) {
      case "get":
        return notifier.prefs();
      case "enabled":
        if (typeof a !== "boolean") throw new Error("bad argument");
        return notifier.setEnabled(a);
      case "agent":
        if (typeof a !== "string" || !a || a.length > 200 || !isAgentNotifyMode(b)) throw new Error("bad argument");
        return notifier.setAgentMode(a, b);
      case "system-settings":
        return notifier.openSystemSettings();
    }
    throw new Error("unknown operation");
  });

  ipcMain.handle(IPC.exportDiagnostics, async (e) => {
    if (!fromRenderer(e)) throw new Error("forbidden");
    const text = buildDiagnostics({ userData: app.getPath("userData"), appVersion: __APP_VERSION__, connectors: connectors?.list() ?? [] });
    const name = `agentstudio-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    // Tests write straight to a folder instead of asking.
    const testDir = process.env.AGENTSTUDIO_TEST_DIAGNOSTICS_DIR;
    let file: string | undefined;
    if (testDir) file = join(testDir, name);
    else {
      const res = await dialog.showSaveDialog({ defaultPath: join(app.getPath("downloads"), name), filters: [{ name: "JSON", extensions: ["json"] }] });
      file = res.canceled ? undefined : res.filePath;
    }
    if (!file) return null;
    writeDiagnostics(file, text);
    return file;
  });

  ipcMain.handle(IPC.openExternal, async (e, url: unknown) => {
    if (!fromRenderer(e) || typeof url !== "string" || !isExternalUrlAllowed(url)) throw new Error("forbidden");
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC.connectors, async (e, op: unknown, a?: unknown, b?: unknown) => {
    if (!fromRenderer(e)) throw new Error("forbidden");
    const str = (v: unknown) => {
      if (typeof v !== "string" || v.length > 200) throw new Error("bad argument");
      return v;
    };
    switch (op) {
      case "services":
        return connectors.services();
      case "list":
        return connectors.list();
      case "begin": {
        const service = str(a);
        if (service !== "grokbot" && service !== "muse" && service !== "dots" && service !== "cue") throw new Error("unknown service");
        return connectors.begin(service);
      }
      case "progress":
        return connectors.progress(str(a));
      case "choose":
        return connectors.choose(str(a), str(b));
      case "submit": {
        if (typeof b !== "string" || b.length > 1000) throw new Error("bad argument");
        return connectors.submit(str(a), b);
      }
      case "cancel":
        return connectors.cancel(str(a));
      case "remove":
        return connectors.remove(str(a));
      case "open":
        return connectors.open(str(a));
      case "attach":
        return connectors.attach(str(a), str(b));
    }
    throw new Error("unknown operation");
  });
}

function registerPersonalIpc() {
  ipcMain.on(PERSONAL_IPC.info, (event) => {
    event.returnValue = fromPersonal(event) ? { platform: process.platform, version: __APP_VERSION__ } : null;
  });
  ipcMain.handle(PERSONAL_IPC.request, (event, input: unknown) => {
    if (!fromPersonal(event) || !personalHost) throw new Error("forbidden");
    return personalHost.request(input as Parameters<PersonalHost["request"]>[0]);
  });
  ipcMain.handle(PERSONAL_IPC.saveArtifact, (event, id: unknown) => {
    if (!fromPersonal(event) || !personalHost || typeof id !== "string") throw new Error("forbidden");
    return personalHost.saveArtifact(id);
  });
  ipcMain.handle(PERSONAL_IPC.restart, async (event) => {
    if (!fromPersonal(event) || !personalHost) throw new Error("forbidden");
    await personalHost.restart();
  });
}

function sendPersonalCommand(command: PersonalCommand) {
  if (!personalMode) return;
  focusWindow();
  mainWindow?.webContents.send(PERSONAL_IPC.command, command);
}

function installMenu() {
  const personalItems: Electron.MenuItemConstructorOptions[] = personalMode ? [
    { label: "新任务", accelerator: "CmdOrCtrl+N", click: () => sendPersonalCommand("new") },
    { label: "搜索", accelerator: "CmdOrCtrl+K", click: () => sendPersonalCommand("search") },
  ] : [];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: "about" },
      ...(personalMode ? [{ label: "设置…", accelerator: "CmdOrCtrl+,", click: () => sendPersonalCommand("settings") }, { type: "separator" as const }] : []),
      { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" },
    ] },
    { label: "文件", submenu: [...personalItems, ...(personalItems.length ? [{ type: "separator" as const }] : []), { role: "close" }] },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "显示", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "窗口", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }] },
  ]));
}

// ---- lifecycle ----------------------------------------------------------------------

const gotLock = userDataDir ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", focusWindow);
  // Sign-in callbacks (cuedev:// for Cue) come back as links.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    if (connectors?.handleLink(url)) focusWindow();
  });
  app.whenReady().then(() => {
    // Run from source, the app is Electron's own bundle: give it AgentStudio's icon in the Dock.
    if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(appIcon);
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!personalMode) {
      storage = new DesktopStorage(dir);
      notifier = new DesktopNotifier(storage, () => {
        focusWindow(); mainWindow?.webContents.send(IPC.notifyClicked);
      });
      connectors = new ConnectorManager(connectorsEnvFromProcess(), dir);
    } else {
      personalHost = new PersonalHost({
        dataDir: resolve(process.env.AGENTSTUDIO_PERSONAL_DATA_DIR || join(dir, "personal")),
        workerPath: join(__dirname, "personal/worker.mjs"), staticDir: join(__dirname, "../renderer/personal"),
        // Finder launches have a minimal PATH. Add ordinary installation paths
        // without sourcing shell startup files or changing the selected account.
        env: { ...process.env, PATH: [process.env.PATH, join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(delimiter) },
        fork: (path, args, options) => utilityProcess.fork(path, args, options),
        processIdentity: (pid) => {
          const metric = app.getAppMetrics().find((entry) => entry.pid === pid && entry.type === "Utility" && entry.name === "AgentStudio Personal Runtime");
          return metric ? { pid: metric.pid, creationTime: metric.creationTime, type: metric.type, name: metric.name || "" } : null;
        },
        buildRef: process.env.PERSONAL_BUILD_REF || __APP_REVISION__, codexCommand: process.env.AGENTSTUDIO_CODEX_BIN,
        testExportDir: process.env.AGENTSTUDIO_PERSONAL_EXPORT_DIR,
        onChanged: (event) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(PERSONAL_IPC.changed, event); },
        chooseSavePath: async (name) => {
          const options = { defaultPath: join(app.getPath("downloads"), name), filters: [{ name: "Markdown", extensions: ["md"] }] };
          const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
          return result.canceled ? null : result.filePath || null;
        },
      });
    }
    // Deny every permission request (camera, mic, geolocation, ...) except notifications.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(!personalMode && permission === "notifications"));
    installCsp();
    registerIpc();
    registerPersonalIpc(); installMenu();
    if (personalMode) void personalHost?.start().catch(() => { /* request() exposes a recoverable startup error to the trusted UI */ });
    else void connectors.start().catch(() => console.error("[agentstudio] connectors failed to start"));
    createWindow();
    app.on("activate", () => {
      // Connector windows are hidden but count as windows; check ours. It may
      // be hidden after a close; before its first show, ready-to-show shows it.
      if (!mainWindow) createWindow();
      else if (windowShown && !mainWindow.isVisible()) mainWindow.show();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    quitting = true;
    if (shutdownComplete) return;
    event.preventDefault();
    if (!shutdownPromise) shutdownPromise = (async () => { await personalHost?.stop(); await connectors?.stop(); })()
      .finally(() => { shutdownComplete = true; app.quit(); });
  });
}
