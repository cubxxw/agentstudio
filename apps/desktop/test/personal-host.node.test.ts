import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { UtilityProcess } from "electron";
import { PersonalHost } from "../src/main/personal-host";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

class FakeUtility extends EventEmitter {
  pid: number | undefined = 4000;
  killed = 0;
  ignoreStop = false;
  ignoreKill = false;
  commands: unknown[] = [];
  constructor(readonly port: number, readonly autoReady = true) { super(); }
  postMessage(value: unknown) {
    this.commands.push(value);
    const command = value as { type: string; ownerId?: string; dataDir?: string };
    if (command.type === "start" && this.autoReady) setImmediate(() => this.emit("message", { type: "ready", ownerId: command.ownerId, workspace: command.dataDir, port: this.port, runtime: { node: "24.22.1", sqlite: "3.53.4", electron: "45.2.1" } }));
    if (command.type === "stop" && !this.ignoreStop) setImmediate(() => { this.pid = undefined; this.emit("exit", 0); });
  }
  kill() { this.killed++; if (!this.ignoreKill) { this.pid = undefined; this.emit("exit", 143); } return true; }
}

type Identity = { pid: number; creationTime: number; type: string; name: string };
async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void, extras: { autoReady?: boolean; chooseSavePath?: () => Promise<string | null>; testExport?: boolean; processIdentity?: (pid: number) => Identity | null; forceKill?: (pid: number) => void } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "agentstudio-native-host-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as { port: number }).port;
  const children: FakeUtility[] = [], forks = new EventEmitter(), changes = vi.fn();
  const host = new PersonalHost({
    dataDir: join(directory, "personal"), workerPath: join(directory, "trusted/worker.mjs"), staticDir: join(directory, "trusted/renderer"),
    env: { PATH: "/usr/bin:/bin", ELECTRON_RUN_AS_NODE: "1" }, startTimeoutMs: extras.autoReady === false ? 20 : 2000, stopTimeoutMs: 200,
    fork: (_path, _args, options) => {
      expect(options.cwd).toBe(join(directory, "personal")); expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      const child = new FakeUtility(port, extras.autoReady !== false); children.push(child); forks.emit("fork", child); return child as unknown as UtilityProcess;
    },
    chooseSavePath: extras.chooseSavePath || (async () => null), onChanged: changes,
    processIdentity: extras.processIdentity, forceKill: extras.forceKill,
    ...(extras.testExport ? { testExportDir: join(directory, "exports") } : {}),
  });
  cleanups.push(() => host.stop());
  return { host, children, forks, changes, directory };
}

describe("owned personal runtime", () => {
  it("waits for the owned ready handshake and forwards one validated API request", async () => {
    let requests = 0;
    const f = await fixture((_request, response) => { requests++; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ok: true })); });
    const response = await f.host.request({ path: "/api/health", method: "GET" });
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ ok: true, desktopRuntime: { electron: "45.2.1", sqlite: "3.53.4" } });
    expect(f.children).toHaveLength(1); expect(requests).toBe(1);
    const start = f.children[0]!.commands[0] as { dataDir: string; ownerId: string };
    expect(start.dataDir).toBe(join(f.directory, "personal")); expect(start.ownerId).toBeTruthy();
    await expect(f.host.request({ path: "https://untrusted.example/api/health", method: "GET" })).rejects.toThrow();
    expect(requests).toBe(1);
  });

  it("ignores unowned ready addresses and fails closed without attaching elsewhere", async () => {
    let requests = 0;
    const f = await fixture((_request, response) => { requests++; response.end("{}"); }, { autoReady: false });
    const response = f.host.request({ path: "/api/bootstrap", method: "GET" });
    await Promise.resolve();
    f.children[0]!.emit("message", { type: "ready", ownerId: "not-the-owned-child", port: 18740 });
    expect((await response).status).toBe(503); expect(requests).toBe(0); expect(f.children[0]!.killed).toBe(1);
  });

  it("does not replay an accepted POST and bounds automatic utility restarts", async () => {
    let writes = 0;
    const f = await fixture((request, response) => {
      if (request.method === "POST") { writes++; response.destroy(); return; }
      response.setHeader("Content-Type", "application/json"); response.end('{"ok":true}');
    });
    expect((await f.host.request({ path: "/api/threads", method: "POST", body: { text: "owned request", clientId: "fixed-request-id" } })).status).toBe(503);
    expect(writes).toBe(1);
    const restarted = once(f.forks, "fork"); f.children[0]!.emit("exit", 1); await restarted;
    expect((await f.host.request({ path: "/api/health", method: "GET" })).status).toBe(200); expect(f.children).toHaveLength(2); expect(writes).toBe(1);
    f.children[1]!.emit("exit", 1);
    expect((await f.host.request({ path: "/api/health", method: "GET" })).status).toBe(503); expect(f.children).toHaveLength(2);
    await f.host.restart(); expect(f.children).toHaveLength(3); expect(writes).toBe(1);
  });

  it("stops only its own utility with a graceful message", async () => {
    const f = await fixture((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end('{}'); });
    await f.host.start(); const owned = f.children[0]!;
    await f.host.stop();
    expect(owned.commands).toContainEqual({ type: "stop" }); expect(owned.killed).toBe(0);
    expect((await f.host.request({ path: "/api/bootstrap", method: "GET" })).status).toBe(503); expect(f.children).toHaveLength(1);
  });

  it("coalesces concurrent restarts into one stop and one ready replacement", async () => {
    const f = await fixture((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end('{}'); });
    await f.host.start();
    const first = f.host.restart(), second = f.host.restart();
    expect(first).toBe(second); await Promise.all([first, second]);
    expect(f.children).toHaveLength(2);
    expect(f.children[0]!.commands.filter((command) => (command as { type: string }).type === "stop")).toHaveLength(1);
    expect((await f.host.request({ path: "/api/health", method: "GET" })).status).toBe(200);
  });

  it("a later external stop wins over an in-flight restart, with no hidden respawn", async () => {
    const f = await fixture((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end('{}'); });
    await f.host.start();
    const restart = f.host.restart();
    const rejected = expect(restart).rejects.toThrow(/后续关闭/);
    await f.host.stop(); await rejected;
    expect(f.children).toHaveLength(1);
    expect((await f.host.request({ path: "/api/health", method: "GET" })).status).toBe(503);
    expect(f.children).toHaveLength(1);
    await f.host.restart();
    expect(f.children).toHaveLength(2);
    expect((await f.host.request({ path: "/api/health", method: "GET" })).status).toBe(200);
  });

  it("stops a replacement that is still starting instead of letting its stale ready win", async () => {
    const f = await fixture((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end('{}'); });
    await f.host.start();
    const next = once(f.forks, "fork"), restarting = f.host.restart();
    const rejected = expect(restarting).rejects.toThrow();
    await next; await f.host.stop(); await rejected;
    expect(f.children).toHaveLength(2);
    expect((await f.host.request({ path: "/api/bootstrap", method: "GET" })).status).toBe(503);
    expect(f.children[1]!.pid).toBeUndefined();
  });

  it("does not report a profile switch safe while its child is still alive", async () => {
    const f = await fixture((_request, response) => response.end('{}'));
    await f.host.start(); const child = f.children[0]!; child.ignoreStop = true; child.ignoreKill = true;
    await expect(f.host.stop(true)).rejects.toThrow(/尚未确认停止/);
    child.pid = undefined; child.emit("exit", 0);
  });

  it("requires the same utility PID, creation time, type and name before forced shutdown", async () => {
    let child: FakeUtility | undefined;
    const forceKill = vi.fn((_pid: number) => { child!.pid = undefined; child!.emit("exit", 137); });
    const f = await fixture((_request, response) => response.end('{}'), {
      processIdentity: (pid) => ({ pid, creationTime: 100, type: "Utility", name: "AgentRoom Personal Runtime" }), forceKill,
    });
    await f.host.start(); child = f.children[0]!; child.ignoreStop = true; child.ignoreKill = true;
    await f.host.stop();
    expect(child.killed).toBe(1); expect(forceKill).toHaveBeenCalledExactlyOnceWith(4000);
  });

  it.each(["missing", "creationTime", "type", "name"])("does not force-kill when the OS identity is %s and refuses an overlapping restart", async (changed) => {
    let afterReady = false;
    const forceKill = vi.fn();
    const f = await fixture((_request, response) => response.end('{}'), {
      processIdentity: (pid) => {
        if (afterReady && changed === "missing") return null;
        return { pid, creationTime: afterReady && changed === "creationTime" ? 200 : 100,
          type: afterReady && changed === "type" ? "Browser" : "Utility", name: afterReady && changed === "name" ? "Another utility" : "AgentRoom Personal Runtime" };
      }, forceKill,
    });
    await f.host.start(); afterReady = true;
    const child = f.children[0]!; child.ignoreStop = true; child.ignoreKill = true;
    await f.host.stop(); expect(forceKill).not.toHaveBeenCalled();
    await expect(f.host.restart()).rejects.toThrow(/原后台仍在关闭/); expect(f.children).toHaveLength(1);
    child.pid = undefined; child.emit("exit", 0);
  });
});

describe("native artifact save", () => {
  const body = "# Original Markdown\n\n| source | value |\n| --- | --- |\n| owned | exact |\n";
  const sha256 = createHash("sha256").update(body).digest("hex");
  it("writes and reads back exact Markdown with its verified SHA-256", async () => {
    const choose = vi.fn(async () => null);
    const f = await fixture((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ title: "../../untrusted title", body, sha256 })); }, { testExport: true, chooseSavePath: choose });
    const saved = await f.host.saveArtifact("art_owned");
    expect(saved).toMatchObject({ cancelled: false, fileName: "art_owned.md", sha256 });
    expect(await readFile(saved.path!, "utf8")).toBe(body); expect((await stat(saved.path!)).mode & 0o777).toBe(0o600); expect(choose).not.toHaveBeenCalled();
    await expect(f.host.saveArtifact("art_owned/../../key")).rejects.toThrow();
  });

  it("honors dialog cancellation and refuses a mismatched artifact before saving", async () => {
    let corrupt = false;
    const choose = vi.fn(async () => null);
    const f = await fixture((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ title: "Owned", body, sha256: corrupt ? "0".repeat(64) : sha256 })); }, { chooseSavePath: choose });
    expect(await f.host.saveArtifact("art_owned")).toEqual({ cancelled: true }); expect(choose).toHaveBeenCalledTimes(1);
    corrupt = true; await expect(f.host.saveArtifact("art_owned")).rejects.toThrow(); expect(choose).toHaveBeenCalledTimes(1);
  });
});
