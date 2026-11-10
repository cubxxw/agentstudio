import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { UtilityProcess } from "electron";
import { isArtifactId, readPersonalRequest, type PersonalChange, type PersonalRequest, type PersonalResponse, type PersonalSaveResult } from "../shared/personal-api";

type OwnedChild = Pick<UtilityProcess, "on" | "once" | "removeListener" | "postMessage" | "kill" | "pid">;
type Fork = (path: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "ignore"; serviceName: string }) => OwnedChild;
type RuntimeInfo = { electron?: string; node: string; sqlite: string };
type UtilityIdentity = { pid: number; creationTime: number; type: string; name: string };
type HostOptions = {
  dataDir: string;
  workerPath: string;
  staticDir: string;
  fork: Fork;
  chooseSavePath(defaultName: string): Promise<string | null>;
  onChanged(event: PersonalChange): void;
  env?: NodeJS.ProcessEnv;
  buildRef?: string;
  codexCommand?: string;
  testExportDir?: string;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  processIdentity?(pid: number): UtilityIdentity | null;
  forceKill?(pid: number): void;
};

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const unavailable = (message: string): PersonalResponse => ({ status: 503, body: { error: { code: "personal_runtime_unavailable", message } } });

/** Owns exactly one utility and one profile. It never attaches to a discovered port. */
export class PersonalHost {
  private child: OwnedChild | null = null;
  private origin: string | null = null;
  private state: "idle" | "starting" | "ready" | "failed" | "stopping" = "idle";
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private restartPromise: Promise<void> | null = null;
  private generation = 0;
  private restartGeneration = -1;
  private shutdownRequested = false;
  private identities = new WeakMap<object, UtilityIdentity>();
  private autoRestarts = 0;
  private expected = new WeakSet<object>();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private error = "本机后台尚未启动";
  private runtime: RuntimeInfo | null = null;

  constructor(private readonly options: HostOptions) {}

  private readIdentity(child: OwnedChild): UtilityIdentity | null {
    if (!child.pid) return null;
    let identity: UtilityIdentity | null | undefined;
    try { identity = this.options.processIdentity?.(child.pid); } catch { return null; }
    if (!identity || identity.pid !== child.pid || identity.type !== "Utility" || identity.name !== "AgentStudio Personal Runtime" || !Number.isFinite(identity.creationTime) || identity.creationTime <= 0) return null;
    return { ...identity };
  }

  private captureIdentity(child: OwnedChild) {
    if (this.identities.has(child)) return;
    const identity = this.readIdentity(child);
    if (identity) this.identities.set(child, identity);
  }

  private forceOwnedChild(child: OwnedChild) {
    const original = this.identities.get(child), current = this.readIdentity(child);
    if (this.child !== child || !original || !current || original.pid !== current.pid || original.creationTime !== current.creationTime || original.name !== current.name || original.type !== current.type) return;
    try { if (this.options.forceKill) this.options.forceKill(current.pid); else process.kill(current.pid, "SIGKILL"); }
    catch { /* already reaped; never search for another process */ }
  }

  async start(): Promise<void> {
    if (this.shutdownRequested) throw new Error("本机后台正在关闭");
    if (this.state === "ready") return;
    if (this.startPromise) return this.startPromise;
    if (this.state === "failed" || this.state === "stopping") throw new Error(this.error);
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.state = "starting";
    mkdirSync(this.options.dataDir, { recursive: true, mode: 0o700 });
    const env = { ...(this.options.env || process.env) }; delete env.ELECTRON_RUN_AS_NODE;
    const ownerId = randomUUID();
    let child: OwnedChild;
    try { child = this.options.fork(this.options.workerPath, [], { cwd: this.options.dataDir, env, stdio: "ignore", serviceName: "AgentStudio Personal Runtime" }); }
    catch { this.state = "failed"; this.error = "本机后台无法启动，请重试"; throw new Error(this.error); }
    this.child = child;
    child.once("spawn", () => this.captureIdentity(child));
    const pending = new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.origin = null; this.state = "failed"; this.error = message;
        this.expected.add(child); child.kill(); reject(new Error(message));
      };
      const timer = setTimeout(() => fail("本机后台启动超时，请检查后重试"), this.options.startTimeoutMs || 15_000);
      timer.unref();
      child.on("message", (message: unknown) => {
        if (this.child !== child || !message || typeof message !== "object") return;
        const data = message as Record<string, unknown>;
        if (data.ownerId !== ownerId) return;
        if (data.type === "ready" && !settled && this.state === "starting") {
          if (data.workspace !== this.options.dataDir || !Number.isInteger(data.port) || Number(data.port) < 1 || Number(data.port) > 65535) { fail("本机后台返回了无效工作区或地址"); return; }
          this.captureIdentity(child);
          settled = true; clearTimeout(timer); this.origin = `http://127.0.0.1:${data.port}`; this.state = "ready";
          this.runtime = data.runtime as RuntimeInfo; resolve(); this.options.onChanged({});
        } else if (data.type === "startup_error") fail(typeof data.message === "string" ? data.message.slice(0, 600) : "本机后台无法启动");
        else if (data.type === "changed" && this.state === "ready") {
          const event = data.event && typeof data.event === "object" ? data.event as PersonalChange : {};
          this.options.onChanged(typeof event.threadId === "string" ? { threadId: event.threadId } : {});
        }
      });
      child.once("exit", () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error("本机后台在启动时退出")); }
        if (this.child !== child) return;
        this.child = null; this.origin = null;
        if (this.expected.has(child) || this.state === "stopping" || this.shutdownRequested) return;
        this.error = "本机后台已停止，任务与决定已保留；可重新启动后台核查";
        if (this.autoRestarts < 1) {
          this.autoRestarts++; this.state = "idle";
          this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.start().catch(() => this.options.onChanged({})); }, 250);
          this.restartTimer.unref();
        } else this.state = "failed";
        this.options.onChanged({});
      });
      try { child.postMessage({ type: "start", ownerId, dataDir: this.options.dataDir, staticDir: this.options.staticDir,
        buildRef: this.options.buildRef, codexCommand: this.options.codexCommand }); }
      catch { fail("无法与本机后台建立连接"); }
    });
    const tracked = pending.finally(() => { if (this.startPromise === tracked) this.startPromise = null; });
    this.startPromise = tracked;
    return tracked;
  }

  async request(input: PersonalRequest): Promise<PersonalResponse> {
    const request = readPersonalRequest(input);
    try { await this.start(); } catch { return unavailable(this.error); }
    const origin = this.origin;
    if (!origin || this.state !== "ready") return unavailable(this.error);
    try {
      const response = await fetch(`${origin}${request.path}`, {
        method: request.method, redirect: "error", signal: AbortSignal.timeout(45_000),
        headers: request.body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const body = await response.json() as unknown;
      if (request.path === "/api/health" && body && typeof body === "object") return { status: response.status, body: { ...body, desktopRuntime: this.runtime } };
      return { status: response.status, body };
    } catch {
      // The original POST may already be accepted. Never repeat it here.
      return unavailable("本次响应未能确认。已接受的任务会保留；请使用原请求标识核查或重试");
    }
  }

  async saveArtifact(id: string): Promise<PersonalSaveResult> {
    if (!isArtifactId(id)) throw new Error("Invalid artifact ID");
    const response = await this.request({ path: `/api/artifacts/${id}`, method: "GET" });
    const artifact = response.body as { title?: unknown; body?: unknown; sha256?: unknown } | null;
    if (response.status !== 200 || !artifact || typeof artifact.body !== "string" || typeof artifact.sha256 !== "string" || hash(artifact.body) !== artifact.sha256) throw new Error("成果无法读取或校验，请重新打开后保存");
    const title = typeof artifact.title === "string" ? artifact.title.replace(/[\\/<>:"|?*\x00-\x1f]/g, "-").slice(0, 100) : id;
    const defaultName = `${title || id}.md`;
    let file: string | null;
    if (this.options.testExportDir) { mkdirSync(this.options.testExportDir, { recursive: true, mode: 0o700 }); file = join(this.options.testExportDir, `${id}.md`); }
    else file = await this.options.chooseSavePath(defaultName);
    if (!file) return { cancelled: true };
    const temporary = join(dirname(file), `.agentstudio-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, artifact.body); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, file);
      if (hash(readFileSync(file)) !== artifact.sha256) throw new Error("保存后的成果校验未通过，文件已保留供核查");
      return { cancelled: false, fileName: basename(file), path: file, sha256: artifact.sha256 };
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch { /* renamed successfully or retained for inspection */ }
    }
  }

  private async stopOwned(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.state = "stopping"; this.origin = null;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    const child = this.child;
    if (!child) return;
    this.expected.add(child);
    this.stopPromise = new Promise<void>((resolve) => {
      let done = false;
      let reapTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (terminated: boolean) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(reapTimer); if (terminated && this.child === child) this.child = null; resolve(); };
      const timer = setTimeout(() => {
        child.kill();
        this.forceOwnedChild(child);
        // Without a matching OS identity keep the tracked handle. A restart may
        // not overlap it; app shutdown still owns and reaps its utility handle.
        if (!done) { reapTimer = setTimeout(() => finish(false), 250); reapTimer.unref(); }
      }, this.options.stopTimeoutMs || 5000);
      timer.unref(); child.once("exit", () => finish(true));
      try { child.postMessage({ type: "stop" }); } catch { child.kill(); }
    }).finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  stop(): Promise<void> {
    this.shutdownRequested = true; this.generation++;
    return this.stopOwned();
  }

  restart(): Promise<void> {
    if (this.restartPromise && this.restartGeneration === this.generation && !this.shutdownRequested) return this.restartPromise;
    const generation = ++this.generation;
    this.restartGeneration = generation; this.shutdownRequested = false;
    const pending = (async () => {
      await this.stopOwned();
      if (this.shutdownRequested || generation !== this.generation) throw new Error("重新启动已被后续关闭操作取消");
      if (this.child) throw new Error("原后台仍在关闭，未启动重叠实例；请稍后重试");
      this.autoRestarts = 0; this.state = "idle";
      await this.start();
      if (this.shutdownRequested || generation !== this.generation) throw new Error("重新启动已被后续关闭操作取消");
      this.options.onChanged({});
    })();
    const tracked = pending.finally(() => { if (this.restartPromise === tracked) this.restartPromise = null; });
    this.restartPromise = tracked;
    return tracked;
  }
}
