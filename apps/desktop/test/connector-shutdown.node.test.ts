import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorManager, connectorsEnvFromProcess } from "../src/main/connectors/manager";
import { ConnectorStore } from "../src/main/connectors/store";
import { GrokClient } from "../src/main/connectors/grokbot";
vi.mock("electron", () => ({ shell: {}, BrowserWindow: vi.fn(), app: {}, nativeImage: {},
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() } }));
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it("drains a rotating token before shutdown and preserves every stored Bot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentroom-shutdown-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new ConnectorStore(directory);
  store.save(["a", "b"].map(id => ({ id, service: "grokbot", name: id, token: `synthetic_${id}`, createdAt: "2026-11-12", data: {
    machineId: "synthetic-machine", accessToken: "synthetic-old", refreshToken: "synthetic-refresh-old", agent: { id, name: id }, lastSeq: 0,
  } })));
  let release!: () => void, started!: () => void;
  const refreshStarted = new Promise<void>(resolve => { started = resolve; });
  const refreshResponse = new Promise<Response>(resolve => { release = () => resolve(new Response(JSON.stringify({ access_token: "synthetic-new", refresh_token: "synthetic-refresh-new" }))); });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/SyntheticProbe")) return new Response(null, { status: 401 });
    if (url.endsWith("/oauth/token")) { started(); return refreshResponse; }
    return new Response(new Uint8Array());
  }));
  const manager = new ConnectorManager(connectorsEnvFromProcess(), directory, { eventSink: () => {} });
  cleanups.push(() => manager.stop());
  await manager.start();
  const client = [...(manager as unknown as { grokClients: Map<string, GrokClient> }).grokClients.values()][0]!;
  const request = client.rpc("SyntheticProbe", [], {}, []).catch(() => {});
  await refreshStarted;
  let stopped = false;
  const stopping = manager.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(stopped).toBe(false);
  release(); await Promise.all([stopping, request]);
  const saved = store.load();
  expect(saved.map(record => record.id)).toEqual(["a", "b"]);
  expect(saved.map(record => (record.data as { refreshToken: string }).refreshToken)).toEqual(["synthetic-refresh-new", "synthetic-refresh-new"]);
  const bytes = await readFile(join(directory, "connectors.bin"));
  await expect(client.rpc("SyntheticProbe", [], {}, [])).rejects.toThrow();
  expect(await readFile(join(directory, "connectors.bin"))).toEqual(bytes);
});

it("does not begin a token refresh if shutdown wins after an RPC's 401 response", async () => {
  let release!: () => void, fetched!: () => void;
  const started = new Promise<void>(resolve => { fetched = resolve; });
  const response = new Promise<Response>(resolve => { release = () => resolve(new Response(null, { status: 401 })); });
  const fetcher = vi.fn(async () => { fetched(); return response; });
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn();
  const client = new GrokClient(connectorsEnvFromProcess().grok, { accessToken: "synthetic", refreshToken: "synthetic" }, "synthetic", changed);
  const pending = client.rpc("SyntheticProbe", [], {}, []);
  await started; await client.close(); release();
  await expect(pending).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled();
});
