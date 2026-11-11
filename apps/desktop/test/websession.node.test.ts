import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createContext, runInContext } from "node:vm";
import type { WebContents } from "electron";
import { WebSession } from "../src/main/connectors/websession";

const fake = vi.hoisted(() => ({ windows: [] as FakeWindow[], loads: [] as Deferred<void>[] }));
vi.mock("electron", () => ({
  app: { userAgentFallback: "Synthetic Chrome/145.0 Electron/45.2.1 AgentRoom/0.1" },
  BrowserWindow: class { constructor(options: WindowOptions) { return new FakeWindow(options); } },
  session: { fromPartition: () => ({ setUserAgent() {}, setPermissionRequestHandler() {} }) },
  shell: { openExternal: vi.fn() },
}));

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
type WindowOptions = { show?: boolean; webPreferences?: Record<string, unknown> };
type PopupReply = { action: string; outlivesOpener?: boolean; overrideBrowserWindowOptions?: WindowOptions };

class FakeWindow extends EventEmitter {
  readonly webContents: EventEmitter & {
    setWindowOpenHandler(handler: (details: { url: string }) => PopupReply): void;
    loadURL(url: string): Promise<void>;
    isDestroyed(): boolean;
    isCrashed(): boolean;
    stop(): void;
  };
  readonly load: Deferred<void>;
  readonly children = new Set<FakeWindow>();
  readonly show = vi.fn(() => { this.visible = true; });
  readonly focus = vi.fn();
  readonly hide = vi.fn(() => { this.visible = false; });
  popup?: (details: { url: string }) => PopupReply;
  private navigation?: Promise<void>;
  visible: boolean;
  destroyed = false;
  destroyCalls = 0;
  constructor(readonly options: WindowOptions) {
    super();
    this.visible = options.show !== false;
    const queued = fake.loads.shift();
    this.load = queued ?? deferred<void>();
    if (!queued) this.load.resolve();
    this.webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: (handler: (details: { url: string }) => PopupReply) => { this.popup = handler; },
      loadURL: (url: string) => this.loadURL(url),
      isDestroyed: () => this.destroyed,
      isCrashed: () => false,
      stop: () => this.load.reject(new Error("Synthetic navigation stopped")),
    });
    fake.windows.push(this);
  }
  loadURL(_url: string) {
    return this.navigation ??= this.load.promise.then(() => {
      if (!this.destroyed) this.webContents.emit("did-finish-load");
    }, error => {
      if (!this.destroyed) this.webContents.emit("did-fail-load", {}, -2, "Synthetic load failed", "https://example.invalid/", true);
      throw error;
    });
  }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.visible = false; this.destroyCalls++;
    this.load.reject(new Error("Synthetic window destroyed"));
    // Electron's default window.open children do not outlive their opener.
    for (const child of this.children) child.destroy();
    this.webContents.emit("destroyed"); this.emit("closed");
  }
  close() {
    let prevented = false;
    this.emit("close", { preventDefault: () => { prevented = true; } });
    if (!prevented) this.destroy();
  }
  openPopup(url: string) {
    const reply = this.popup!({ url });
    if (reply.action !== "allow") return null;
    const child = new FakeWindow({ ...reply.overrideBrowserWindowOptions,
      webPreferences: { ...this.options.webPreferences, ...reply.overrideBrowserWindowOptions?.webPreferences } });
    if (!reply.outlivesOpener) this.children.add(child);
    this.webContents.emit("did-create-window", child, { url });
    return child;
  }
}

type SignInWithReady = (check: (wc: WebContents) => Promise<boolean>, signal: AbortSignal, onReady?: () => void, isReady?: (wc: WebContents) => Promise<boolean>) => Promise<void>;
function fixture(check = vi.fn(async (_wc: WebContents) => false), isReady?: (wc: WebContents) => Promise<boolean>) {
  const load = deferred<void>(); fake.loads.push(load);
  const session = new WebSession({ partition: "persist:synthetic-websession", url: "https://example.invalid/", title: "Synthetic service" });
  const controller = new AbortController(), onReady = vi.fn();
  // The previous signature has no readiness callback. Calling it still gives a
  // behavioral RED result instead of a TypeScript argument-count failure.
  const signIn = session.signIn.bind(session) as SignInWithReady;
  const outcome: { state: "pending" | "resolved" | "rejected"; error?: Error } = { state: "pending" };
  const promise = signIn(check, controller.signal, onReady, isReady);
  void promise.then(() => { outcome.state = "resolved"; }, error => { outcome.state = "rejected"; outcome.error = error; });
  return { session, load, controller, onReady, check, promise, outcome, login: () => fake.windows[0]! };
}
const turn = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => { vi.useFakeTimers(); fake.windows = []; fake.loads = []; });
afterEach(async () => {
  for (const win of fake.windows) win.destroy();
  await vi.advanceTimersByTimeAsync(1000);
  vi.clearAllTimers(); vi.useRealTimers();
});

describe("background session startup", () => {
  it("bounds a debugger command that never returns and never executes it late", async () => {
    const session = new WebSession({ partition: "persist:synthetic-websession", url: "https://example.invalid/", title: "Synthetic" });
    await session.open();
    const frame = deferred<unknown>(); const commands: string[] = [];
    Object.assign(session.webContents!, { debugger: {
      isAttached: () => true,
      sendCommand: async (method: string) => { commands.push(method); return frame.promise; },
    } });
    const outcome: { error?: Error } = {};
    void session.eval("must not execute").catch(error => { outcome.error = error; });
    await vi.advanceTimersByTimeAsync(5001);
    expect(outcome.error?.message).toMatch(/timed out/);
    frame.resolve({ frameTree: { frame: { id: "late" } } }); await turn();
    expect(commands).toEqual(["Page.getFrameTree"]);
  });

  it("returns from recovery while new media is still loading", async () => {
    const session = new WebSession({ partition: "persist:synthetic-websession", url: "https://example.invalid/", title: "Synthetic" });
    await session.open();
    const load = deferred<void>();
    session.webContents!.loadURL = () => load.promise;
    let recovered = false;
    void session.recover().then(() => { recovered = true; }); await turn();
    expect(recovered).toBe(true);
    load.resolve();
  });

  it("evaluates the chat driver in an isolated world before media finishes loading", async () => {
    const load = deferred<void>(); fake.loads.push(load);
    const session = new WebSession({ partition: "persist:synthetic-websession", url: "https://example.invalid/", title: "Synthetic" });
    await session.open();
    const wc = session.webContents!;
    const main = createContext({ pageSecret: "not visible to driver" });
    const isolated = createContext({});
    let attached = false;
    Object.assign(wc, {
      executeJavaScriptInIsolatedWorld: async () => { await load.promise; return "too late"; },
      debugger: {
        isAttached: () => attached,
        attach: () => { attached = true; },
        sendCommand: async (method: string, params: any) => {
          if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main-frame" } } };
          if (method === "Page.createIsolatedWorld") {
            expect(params.frameId).toBe("main-frame");
            expect(params.grantUniveralAccess).not.toBe(true);
            return { executionContextId: 7 };
          }
          if (method === "Runtime.evaluate") {
            if (params.contextId !== 7) throw new Error("Must use the isolated context");
            return { result: { value: runInContext(params.expression, isolated) } };
          }
          throw new Error("Unexpected protocol command");
        },
      },
    });
    let result: unknown;
    void session.eval("globalThis.driverState = 42; typeof pageSecret").then(value => { result = value; }, () => {});
    await turn();
    expect(result).toBe("undefined");
    expect(runInContext("typeof driverState", main)).toBe("undefined");
    expect(await session.eval("driverState")).toBe(42);
    session.close();
  });

  it("starts a restored connector without waiting for the page's full load", async () => {
    const load = deferred<void>(); fake.loads.push(load);
    const session = new WebSession({ partition: "persist:synthetic-websession", url: "https://example.invalid/", title: "Synthetic service" });
    let opened = false;
    void session.open().then(() => { opened = true; });
    await turn();
    expect(opened).toBe(true);
    expect(session.webContents).not.toBeNull();
    expect(fake.windows[0]!.options.webPreferences).toMatchObject({
      partition: "persist:synthetic-websession", contextIsolation: true, sandbox: true, nodeIntegration: false,
    });
    expect(fake.windows[0]!.visible).toBe(false);
    session.close(); await turn();
    expect(session.webContents).toBeNull();
  });

  it("records a late navigation failure without rejecting startup or losing the owned session", async () => {
    const load = deferred<void>(); fake.loads.push(load);
    const session = new WebSession({ partition: "persist:synthetic-websession", url: "https://example.invalid/", title: "Synthetic service" });
    let opened = false;
    void session.open().then(() => { opened = true; });
    await turn();
    expect(opened).toBe(true);
    load.reject(new Error("Synthetic resource load failed")); await turn();
    expect(session.broken).toContain("didn't load");
    expect(session.webContents).not.toBeNull();
    session.close();
  });
});

describe("web sign-in readiness and cancellation", () => {
  it("does not expose an interactive login window while its initial page is still loading", async () => {
    const f = fixture();
    await turn();
    expect(f.login().visible).toBe(false);
    expect(f.login().show).not.toHaveBeenCalled();
    expect(f.onReady).not.toHaveBeenCalled();
  });

  it("aborts pending initial navigation immediately and destroys its owned login window", async () => {
    const f = fixture();
    f.controller.abort(); await turn();
    expect(f.outcome.state).toBe("rejected");
    expect(f.outcome.error?.message).toMatch(/cancel|取消/i);
    expect(f.login().destroyed).toBe(true);
    expect(f.onReady).not.toHaveBeenCalled();
  });

  it("does not create any window when the sign-in was already cancelled", async () => {
    const session = new WebSession({ partition: "persist:synthetic-websession", url: "https://example.invalid/", title: "Synthetic" });
    const controller = new AbortController(); controller.abort();
    const promise = session.signIn(async () => false, controller.signal);
    void promise.catch(() => {}); await turn();
    expect(fake.windows).toHaveLength(0);
    await expect(promise).rejects.toThrow(/cancel|取消/i);
  });

  it("accepts an already signed-in DOM without waiting for every navigation resource", async () => {
    const f = fixture(vi.fn(async (_wc: WebContents) => true));
    // The hidden follow-up navigation can also remain pending. A completed
    // login must not become stuck on a second full page load.
    fake.loads.push(deferred<void>());
    f.login().webContents.emit("dom-ready");
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.check).toHaveBeenCalled();
    expect(f.outcome.state).toBe("resolved");
    expect(f.login().destroyed).toBe(true);
    expect(f.onReady).not.toHaveBeenCalled();
  });

  it.each(["abort", "close"] as const)("cancels with %s even while the signed-in checker is pending", async action => {
    const checking = deferred<boolean>();
    const f = fixture(vi.fn((_wc: WebContents) => checking.promise));
    f.load.resolve(); await vi.advanceTimersByTimeAsync(1000);
    expect(f.check).toHaveBeenCalled();
    if (action === "abort") f.controller.abort();
    else f.login().close();
    await turn();
    expect(f.outcome.state).toBe("rejected");
    expect(f.login().destroyed).toBe(true);
    const windowCount = fake.windows.length;
    checking.resolve(true); await turn();
    expect(fake.windows).toHaveLength(windowCount);
    expect(f.outcome.state).toBe("rejected");
  });

  it("keeps OAuth popups in the same sandboxed partition and closes owned windows on cancel", async () => {
    const f = fixture();
    const popup = f.login().openPopup("https://accounts.example.invalid/login")!;
    expect(popup.options.webPreferences).toMatchObject({
      partition: "persist:synthetic-websession", contextIsolation: true, sandbox: true, nodeIntegration: false,
    });
    expect(f.login().popup!({ url: "file:///synthetic" }).action).toBe("deny");
    expect(f.login().popup!({ url: "example-app://callback" }).action).toBe("deny");
    f.controller.abort(); await turn();
    expect(f.login().destroyed).toBe(true);
    expect(popup.destroyed).toBe(true);
    expect(f.outcome.state).toBe("rejected");
  });

  it("treats closing the login window as cancellation and closes its owned popups", async () => {
    const f = fixture();
    const popup = f.login().openPopup("https://accounts.example.invalid/login")!;
    f.login().close(); await turn();
    expect(f.outcome.state).toBe("rejected");
    expect(f.login().destroyed).toBe(true);
    expect(popup.destroyed).toBe(true);
    expect(f.onReady).not.toHaveBeenCalled();
  });

  it("rejects a failed initial load rather than polling an unusable login page forever", async () => {
    const f = fixture();
    f.load.reject(new Error("Synthetic initial page load failed")); await turn();
    expect(f.outcome.state).toBe("rejected");
    expect(f.outcome.error?.message).toMatch(/load|加载|页面/i);
    expect(f.login().destroyed).toBe(true);
    expect(f.onReady).not.toHaveBeenCalled();
  });

  it("shows the ready page and reports readiness once after initial navigation settles", async () => {
    const f = fixture();
    f.load.resolve(); await turn();
    expect(f.login().visible).toBe(true);
    expect(f.login().show).toHaveBeenCalledTimes(1);
    expect(f.onReady).toHaveBeenCalledTimes(1);
    f.login().webContents.emit("did-finish-load");
    f.login().webContents.emit("did-finish-load"); await turn();
    expect(f.login().show).toHaveBeenCalledTimes(1);
    expect(f.onReady).toHaveBeenCalledTimes(1);
    expect(f.outcome.state).toBe("pending");
  });

  it("shows a ready login form while full load is pending and clears the initial-load deadline", async () => {
    const isReady = vi.fn(async (_wc: WebContents) => true);
    const f = fixture(vi.fn(async (_wc: WebContents) => false), isReady);
    await vi.advanceTimersByTimeAsync(1000);
    expect(isReady).toHaveBeenCalled();
    expect(f.login().visible).toBe(true);
    expect(f.login().show).toHaveBeenCalledTimes(1);
    expect(f.onReady).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_001);
    expect(f.outcome.state).toBe("pending");
    expect(f.login().destroyed).toBe(false);
    expect(f.onReady).toHaveBeenCalledTimes(1);
    f.controller.abort(); await turn();
    expect(f.outcome.state).toBe("rejected");
  });

  it("keeps a ready login active when the original navigation later reports ERR_ABORTED", async () => {
    const f = fixture(vi.fn(async (_wc: WebContents) => false), vi.fn(async (_wc: WebContents) => true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.onReady).toHaveBeenCalledTimes(1);
    f.load.reject(Object.assign(new Error("ERR_ABORTED (-3)"), { code: "ERR_ABORTED", errno: -3 }));
    await turn();
    expect(f.outcome.state).toBe("pending");
    expect(f.login().destroyed).toBe(false);
    expect(f.onReady).toHaveBeenCalledTimes(1);
    f.controller.abort(); await turn();
    expect(f.outcome.state).toBe("rejected");
  });

  it("bounds the initial loading stage instead of waiting indefinitely", async () => {
    const f = fixture();
    await vi.advanceTimersByTimeAsync(90_001);
    expect(f.outcome.state).toBe("rejected");
    expect(f.outcome.error?.message).toMatch(/load|加载|页面|timeout|超时/i);
    expect(f.login().destroyed).toBe(true);
    expect(f.onReady).not.toHaveBeenCalled();
  });
});
