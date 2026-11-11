import { expect, it, vi } from "vitest";
import { ConnectorManager } from "../src/main/connectors/manager";
const { writeText } = vi.hoisted(() => ({ writeText: vi.fn(async (_text: string) => {}) }));
vi.mock("electron", () => ({ clipboard: { writeText }, shell: {}, BrowserWindow: vi.fn(), app: { getPath: () => "/synthetic" } }));
vi.mock("../src/main/connectors/grokbot", async importOriginal => ({ ...await importOriginal<any>(),
  grokLogin: async (_cfg: unknown, _open: unknown, signal: AbortSignal, view: any) => {
    view.onStart({ url: "https://cursor.com/loginDeepControl?challenge=synthetic", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  },
}));
it("copies only the current main-owned sign-in link and refuses a cancelled flow", async () => {
  const manager = Object.create(ConnectorManager.prototype) as ConnectorManager;
  Object.assign(manager, { logins: new Map(), env: { grok: {} } });
  const id = manager.begin("grokbot");
  await manager.choose(id, "copy-login");
  expect(writeText).toHaveBeenCalledWith("https://cursor.com/loginDeepControl?challenge=synthetic");
  expect(writeText).toHaveBeenCalledTimes(1);
  manager.cancel(id); await expect(manager.choose(id, "copy-login")).rejects.toThrow("已失效");
  expect(writeText).toHaveBeenCalledTimes(1);
});
