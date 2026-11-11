// Main-process-only adapter. Provider credentials stay in ConnectorStore / isolated
// Electron partitions. Only private progress contains the local A2A bearer token.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { SERVICES, type ConnectorSummary, type DirectConnectorEvent, type LoginProgress, type ServiceId } from "./connectors/types";
import type { InboundMessage } from "./connectors/protocol";
import type { ConnectorsEnv } from "./connectors/manager";

export type PersonalServiceInstance = { instanceId: string; name: string; url: string; token: string };
export type PersonalServicesProgress = Exclude<LoginProgress, { state: "ready" }> | { state: "ready"; instances: PersonalServiceInstance[] };
export type PublicPersonalServicesProgress = Exclude<LoginProgress, { state: "ready" }> | { state: "ready"; instances: { instanceId: string; name: string }[] };
export type PersonalServiceSummary = Omit<ConnectorSummary, "url" | "connectionId">;
export interface PersonalServicesManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  list(): ConnectorSummary[];
  registrations(): { instanceId: string; name: string; token: string }[];
  begin(service: ServiceId): string;
  progress(id: string): LoginProgress;
  choose(id: string, choice: string): void;
  submit(id: string, value: string): void;
  cancel(id: string): void;
  open(id: string): void;
  remove(id: string): Promise<void>;
  handleLink?(url: string): boolean;
  sendDirect(id: string, message: InboundMessage): Promise<void>;
}
export type PersonalServicesOptions = {
  userData: string;
  env?: ConnectorsEnv;
  createManager?(input: { directory: string; partitionPrefix: string; onEvent(id: string, event: DirectConnectorEvent): void }): PersonalServicesManager | Promise<PersonalServicesManager>;
};
type TaskState = "submitted" | "working" | "input-required" | "completed" | "unknown";
type TaskRecord = {
  id: string; instanceId: string; messageId: string; requestHash: string;
  state: TaskState; createdAt: string; updatedAt: string; text: string[];
  explanation?: string; uncertain?: boolean;
};
type Manifest = { version: 1; chosenPort: number; tasks: TaskRecord[] };
const validId = /^[A-Za-z0-9_-]{1,160}$/;
const now = () => new Date().toISOString();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const unresolved = (task: TaskRecord) => task.state !== "completed";

/** No network, keychain access or directory creation until restore/list/begin. */
export class PersonalServices {
  private readonly directory: string;
  private readonly manifestPath: string;
  private manager: PersonalServicesManager | null = null;
  private server: Server | null = null;
  private manifest: Manifest = { version: 1, chosenPort: 0, tasks: [] };
  private initializing: Promise<void> | null = null;
  private stopping = false;
  private stopPromise: Promise<void> | null = null;
  private storageFault = false;
  private readonly secrets = new Set<string>();
  private readonly sends = new Map<string, { accepted: boolean; completionReady: boolean; buffered: DirectConnectorEvent[] }>();
  private readonly loginFlows = new Set<string>();
  constructor(private readonly options: PersonalServicesOptions) {
    this.directory = join(options.userData, "personal-services");
    this.manifestPath = join(this.directory, "manifest.json");
  }

  services() {
    return SERVICES.map((service) => ({ ...service, notice: "使用服务自身已有对话；不会导入历史。需要在原服务处理的决定不会自动批准。" }));
  }
  hasUnresolvedTasks() { return this.storageFault || this.manifest.tasks.some(task => unresolved(task)); }
  hasPendingLogin() {
    for (const flowId of this.loginFlows) {
      const state = this.manager?.progress(flowId).state;
      if (state && ['ready', 'failed', 'cancelled'].includes(state)) this.loginFlows.delete(flowId);
    }
    return this.loginFlows.size > 0;
  }
  async restore(): Promise<boolean> {
    if (!existsSync(this.manifestPath)) return false;
    await this.initialize(); return true;
  }
  async list(): Promise<PersonalServiceSummary[]> {
    await this.initialize();
    return this.manager!.list().map(({ id, service, name, status, message, canOpen }) => ({ id, service, name: this.clean(name), status, ...(message ? { message: this.clean(message) } : {}), canOpen }));
  }
  async begin(service: ServiceId): Promise<string> {
    if (!SERVICES.some((entry) => entry.id === service)) throw new Error("Unknown personal service");
    await this.initialize(); const flowId = this.manager!.begin(service); this.loginFlows.add(flowId); return flowId;
  }
  /** PRIVATE: only main may register these tokens with its owned personal backend. */
  async registrations(): Promise<PersonalServiceInstance[]> {
    await this.initialize();
    return this.manager!.registrations().map((entry) => {
      this.secrets.add(entry.token);
      return { ...entry, url: this.urlFor(entry.instanceId) };
    });
  }
  async progress(flowId: string): Promise<PersonalServicesProgress> {
    await this.initialize();
    const progress = this.manager!.progress(flowId);
    if (progress.state !== "ready") { const clean = this.cleanValue(progress); clean.state = progress.state; return clean; }
    return { state: "ready", instances: progress.instances.map((entry) => {
      this.secrets.add(entry.token);
      return { instanceId: entry.instanceId, name: this.clean(entry.name), token: entry.token, url: this.urlFor(entry.instanceId) };
    }) };
  }
  async publicProgress(flowId: string): Promise<PublicPersonalServicesProgress> {
    const progress = await this.progress(flowId);
    if (progress.state === "ready") return { state: "ready", instances: progress.instances.map(({ instanceId, name }) => ({ instanceId, name })) };
    if (progress.state === "failed") return { state: "failed", message: /^Sign-in page (could not load|load timed out)/.test(progress.message) ? "登录页面未能载入，请检查网络后重新连接；已有登录信息与连接保留。" : "登录未完成，请检查原服务的登录页面或重新连接；已有连接仍保留。" };
    if (progress.state === "input") return { state: "input", message: "请按原服务的说明完成连接。凭据仅保存在本机。", label: progress.label, secret: progress.secret,
      ...(progress.link ? { link: progress.link } : {}), ...(progress.error ? { error: "服务未接受此次输入，请核对后重试。" } : {}) };
    if (progress.state === "choose") return { state: "choose", message: "选择你要接入的个人助手", choices: progress.choices };
    if (progress.state === "waiting") return { state: "waiting", message: /^Loading sign-in page/.test(progress.message) ? "正在载入登录页面，准备好后会打开窗口。首次加载可能较慢，可以随时取消。" : /checking|connecting|creating/i.test(progress.message) ? "正在核对账号与可用助手…" : "请在原服务的登录页面完成验证，完成后会自动接入。", ...(progress.actions ? { actions: progress.actions.map(action => ({ ...action, label: action.id === "api-key" ? "改用访问密钥" : action.label })) } : {}) };
    return { state: "cancelled" };
  }
  async choose(flowId: string, choiceId: string) { await this.initialize(); this.manager!.choose(flowId, choiceId); }
  async submit(flowId: string, value: string) {
    if (typeof value !== "string" || value.length > 8000 || /[\r\n\x00]/.test(value)) throw new Error("Invalid sign-in value");
    await this.initialize(); if (value) this.secrets.add(value); this.manager!.submit(flowId, value);
  }
  async cancel(flowId: string) { await this.initialize(); this.manager!.cancel(flowId); this.loginFlows.delete(flowId); }
  async open(instanceId: string) { await this.initialize(); this.manager!.open(instanceId); }
  async remove(instanceId: string) {
    await this.initialize();
    if (!validId.test(instanceId) || !this.manager!.registrations().some((entry) => entry.instanceId === instanceId)) throw new Error("Unknown personal service instance");
    if (this.manifest.tasks.some((task) => task.instanceId === instanceId && unresolved(task))) throw new Error("该连接仍有执行或待核查结果，请先在原服务核查，不能移除核查渠道");
    await this.manager!.remove(instanceId);
  }
  handleLink(url: string) { return this.manager?.handleLink?.(url) ?? false; }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const pending = this.stopOwned(); this.stopPromise = pending; return pending;
  }
  private async stopOwned() {
    this.stopping = true;
    await this.initializing?.catch(() => {});
    if (this.server && !this.storageFault) {
      for (const task of this.manifest.tasks) if (task.state !== "completed") { task.state = "unknown"; task.uncertain = true; task.updatedAt = now(); task.explanation = "应用已关闭，原服务执行尚未确认；不会自动重发。"; }
      try { this.save(); } catch { /* durable prior records remain for restart reconciliation */ }
    }
    try { if (this.manager) await this.manager.stop(); }
    finally {
      this.manager = null;
      const server = this.server; this.server = null;
      if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    }
  }

  private clean(value: string): string {
    let text = value;
    for (const secret of this.secrets) if (secret) text = text.replaceAll(secret, "[redacted]");
    return text;
  }
  private cleanValue<T>(value: T): T {
    const visit = (item: unknown): unknown => typeof item === "string" ? this.clean(item)
      : Array.isArray(item) ? item.map(visit)
      : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).map(([key, content]) => [key, visit(content)])) : item;
    return visit(value) as T;
  }
  private urlFor(id: string) { return `http://127.0.0.1:${this.manifest.chosenPort}/a2a/${id}`; }
  private save() {
    const temporary = join(this.directory, `.manifest-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, JSON.stringify(this.manifest)); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, this.manifestPath); chmodSync(this.manifestPath, 0o600);
      const dir = openSync(this.directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
    } catch (error) { this.storageFault = true; throw error; }
    finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary); } catch { /* renamed */ } }
  }
  private async initialize(): Promise<void> {
    if (this.stopping || this.storageFault) throw new Error("Personal services are unavailable; original records have been retained");
    if (this.manager) return;
    if (this.initializing) return this.initializing;
    const pending = this.initializeOwned();
    this.initializing = pending;
    try { await pending; } finally { if (this.initializing === pending) this.initializing = null; }
  }
  private async initializeOwned() {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 }); chmodSync(this.directory, 0o700);
    if (existsSync(this.manifestPath)) {
      const input = JSON.parse(readFileSync(this.manifestPath, "utf8")) as Manifest;
      if (input.version !== 1 || !Number.isInteger(input.chosenPort) || input.chosenPort < 1 || input.chosenPort > 65535 || !Array.isArray(input.tasks)
        || input.tasks.some((task) => !task || !validId.test(task.id) || !validId.test(task.instanceId) || !validId.test(task.messageId) || !Array.isArray(task.text) || task.text.some((text) => typeof text !== "string") || !/^[0-9a-f]{64}$/.test(task.requestHash)
          || !["submitted", "working", "input-required", "completed", "unknown"].includes(task.state))) throw new Error("Personal services manifest is invalid; original data has been retained");
      this.manifest = input;
      for (const task of input.tasks) if (task.state !== "completed") {
        task.state = "unknown"; task.uncertain = true; task.updatedAt = now(); task.explanation = "应用已重启。原服务可能已收到内容；只保留查询，不自动重发。";
      }
    }
    const server = createServer((req, res) => { void this.handle(req, res).catch(() => {
      if (!res.headersSent) this.json(res, 500, { error: { code: "personal_service_error", message: "个人服务响应未能确认" } });
    }); });
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(this.manifest.chosenPort, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Personal service host has no local address");
      this.manifest.chosenPort = address.port; this.server = server; this.save();
      const onEvent = (id: string, event: DirectConnectorEvent) => this.event(id, event);
      let manager: PersonalServicesManager;
      if (this.options.createManager) manager = await this.options.createManager({ directory: this.directory, partitionPrefix: "persist:agentstudio-personal-services", onEvent });
      else {
        const { safeStorage } = await import("electron");
        if (!safeStorage.isEncryptionAvailable()) throw new Error("系统凭据加密不可用；未开始登录，请恢复后重试");
        const { ConnectorManager, connectorsEnvFromProcess } = await import("./connectors/manager");
        manager = new ConnectorManager({ ...(this.options.env ?? connectorsEnvFromProcess()), port: 0 }, this.directory,
          { partitionPrefix: "persist:agentstudio-personal-services", eventSink: onEvent, disableTracing: true });
      }
      try { await manager.start(); } catch (error) { await manager.stop().catch(() => {}); throw error; }
      if (existsSync(join(this.directory, "connectors.bin")) && !manager.registrations().length) {
        await manager.stop(); throw new Error("保存的个人连接未能恢复，原凭据文件已保留；请恢复系统凭据访问后重试");
      }
      this.manager = manager;
      for (const entry of manager.registrations()) this.secrets.add(entry.token);
    } catch (error) {
      this.server = null; server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }
  private json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(value));
  }
  private taskResult(task: TaskRecord) {
    return { kind: "task", id: task.id, contextId: task.instanceId,
      status: { state: task.state, timestamp: task.updatedAt, ...(task.explanation ? { message: { kind: "message", role: "agent", messageId: `${task.id}_status`, parts: [{ kind: "text", text: task.explanation }] } } : {}) },
      ...(task.state === "completed" ? { artifacts: [{ artifactId: `${task.id}_result`, name: "服务返回内容", parts: [{ kind: "text", text: task.text.join("\n\n") }] }] } : {}),
      metadata: { source: "personal-service", receiptScope: "single_active_service_conversation", uncertain: Boolean(task.uncertain), replayAllowed: false } };
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (this.stopping || this.storageFault) return this.json(res, 503, { error: "Personal service storage or lifecycle is unavailable; accepted requests are not replayed" });
    const port = this.manifest.chosenPort;
    const host = req.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host ?? "") || req.headers.origin !== undefined || req.headers["sec-fetch-site"] === "cross-site") return this.json(res, 403, { error: "Local service access only" });
    const match = /^\/a2a\/([A-Za-z0-9_-]{1,160})$/.exec(req.url ?? "");
    if (!match || req.method !== "POST" || req.headers["content-type"]?.split(";")[0] !== "application/json") return this.json(res, 404, { error: "Not found" });
    const instanceId = match[1]!;
    const instance = this.manager?.registrations().find((entry) => entry.instanceId === instanceId);
    const got = Buffer.from(req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1] ?? "");
    const expected = Buffer.from(instance?.token ?? "");
    if (!instance || !got.length || got.length !== expected.length || !timingSafeEqual(got, expected)) return this.json(res, 401, { error: "Unauthenticated" });
    this.secrets.add(instance.token);
    let bytes = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += (chunk as Buffer).length;
      if (bytes > 1_000_000) { this.json(res, 413, { error: "Request too large" }); return; }
      chunks.push(chunk as Buffer);
    }
    let body: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return this.json(res, 400, { error: "Invalid JSON" }); }
    if (!body || body.jsonrpc !== "2.0" || (typeof body.id !== "string" && typeof body.id !== "number")) return this.json(res, 400, { error: "Invalid JSON-RPC request" });
    const rpcError = (code: number, message: string) => this.json(res, 200, { jsonrpc: "2.0", id: body.id, error: { code, message } });
    const params = body.params as { id?: unknown; message?: { kind?: unknown; role?: unknown; messageId?: unknown; parts?: unknown } } | null;
    if (body.method === "tasks/get") {
      const task = this.manifest.tasks.find((entry) => entry.id === params?.id && entry.instanceId === instanceId);
      return task ? this.json(res, 200, { jsonrpc: "2.0", id: body.id, result: this.taskResult(task) }) : rpcError(-32001, "Unknown task");
    }
    if (body.method !== "message/send") return rpcError(-32601, "Unsupported method");
    const message = params?.message;
    if (!message || message.kind !== "message" || message.role !== "user" || typeof message.messageId !== "string" || !validId.test(message.messageId)
      || !Array.isArray(message.parts) || !message.parts.length || message.parts.some((part: unknown) => !part || typeof part !== "object" || (part as { kind?: unknown }).kind !== "text" || typeof (part as { text?: unknown }).text !== "string")) return rpcError(-32602, "A text message with a stable messageId is required");
    const text = (message.parts as { kind: string; text: string }[]).map((part) => part.text).join("\n\n");
    if (!text.trim() || text.length > 100_000) return rpcError(-32602, "Invalid message length");
    const requestHash = digest(JSON.stringify(message.parts));
    const previous = this.manifest.tasks.find((task) => task.instanceId === instanceId && task.messageId === message.messageId);
    if (previous) return previous.requestHash === requestHash ? this.json(res, 200, { jsonrpc: "2.0", id: body.id, result: this.taskResult(previous) }) : rpcError(-32602, "messageId already belongs to another payload");
    if (this.manifest.tasks.some((task) => task.instanceId === instanceId && unresolved(task))) return rpcError(-32002, "An earlier task is unresolved; inspect the original service. It must not be overwritten or replayed.");
    if (this.manager!.list().find((entry) => entry.id === instanceId)?.status !== "ready") return rpcError(-32003, "The service is not ready; sign in or recover it first");
    const task: TaskRecord = { id: `pst_${randomUUID()}`, instanceId, messageId: message.messageId, requestHash, state: "submitted", createdAt: now(), updatedAt: now(), text: [] };
    this.manifest.tasks.push(task); this.save(); // Must be durable before any external send.
    this.sends.set(task.id, { accepted: false, completionReady: false, buffered: [] });
    this.json(res, 200, { jsonrpc: "2.0", id: body.id, result: this.taskResult(task) });
    void this.dispatch(task, text);
  }
  private async dispatch(task: TaskRecord, text: string) {
    try {
      await this.manager!.sendDirect(task.instanceId, { session_id: `personal:${task.id}`, message_id: task.messageId, text, sent_at: task.createdAt });
      const send = this.sends.get(task.id);
      if (!send || this.stopping) return;
      send.accepted = true;
      if (task.state === "submitted") { task.state = "working"; task.updatedAt = now(); this.save(); }
      for (const event of send.buffered.splice(0)) this.event(task.instanceId, event);
    } catch {
      if (this.stopping) return;
      this.sends.delete(task.id); task.state = "unknown"; task.uncertain = true; task.updatedAt = now();
      task.explanation = "发送响应未能确认，原服务可能已收到。请在原服务核查；不会自动重发。"; this.save();
    }
  }
  private event(instanceId: string, raw: DirectConnectorEvent) {
    if (this.stopping) return;
    const task = this.manifest.tasks.find((entry) => entry.instanceId === instanceId && unresolved(entry));
    if (!task || task.state === "unknown") return;
    const send = this.sends.get(task.id);
    if (!send) return;
    if (!send.accepted) { if (send.buffered.length < 100) send.buffered.push(raw); return; }
    const event = raw.type === "message" ? { ...raw, text: this.clean(raw.text) } : raw;
    if (event.type === "input_required" && event.messageId === task.messageId) {
      send.completionReady = false;
      task.state = "input-required"; task.explanation = "服务需要你在原服务处理一个步骤；此处不会自动选择或批准。";
    } else if (event.type === "uncertain" && event.messageId === task.messageId) {
      task.state = "unknown"; task.uncertain = true; task.explanation = "服务回复归属或执行状态未能确认。请在原服务核查；不会自动重发。";
    } else if (event.type === "message") {
      if (event.history) return;
      if (event.from_user) {
        task.state = "unknown"; task.uncertain = true; task.explanation = "原服务出现另一条用户消息，回复归属无法确定。请在原服务核查；不会自动覆盖或重发。";
      } else if (event.reply_to === task.messageId && event.text.trim()) {
        task.text.push(event.text);
        if (task.state === "working") send.completionReady = true;
      }
      // Uncorrelated replies, history and autonomous provider messages are never results.
    } else if (event.type === "approval_request") {
      send.completionReady = false;
      task.state = "input-required"; task.explanation = "服务需要你处理一个决定。请打开原服务核对；此处不会自动选择或批准。";
    } else if (event.type === "status" && event.state === "working" && task.state === "input-required") {
      task.state = "working"; task.explanation = undefined;
      // Earlier partial text cannot complete the resumed phase on an idle-only event.
      send.completionReady = false;
    } else if (event.type === "status" && event.state === "idle" && task.state === "working" && send.completionReady && task.text.length) {
      task.state = "completed"; this.sends.delete(task.id);
    } else return;
    task.updatedAt = now(); this.save();
  }
}
