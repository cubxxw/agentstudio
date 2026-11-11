import { expect, it, vi } from "vitest";
import { ConnectorManager } from "../src/main/connectors/manager";
vi.mock("electron",()=>({shell:{},BrowserWindow:vi.fn(),app:{getPath:()=>"/synthetic"}}));
it("reuses the pending Grok flow and creates a new request only after cancellation or failure",()=>{
 const manager=Object.create(ConnectorManager.prototype) as ConnectorManager;
 const runLogin=vi.fn(async()=>{});Object.assign(manager,{logins:new Map(),runLogin});
 const first=manager.begin("grokbot");expect(manager.begin("grokbot")).toBe(first);expect(runLogin).toHaveBeenCalledTimes(1);
 manager.cancel(first);const second=manager.begin("grokbot");expect(second).not.toBe(first);expect(runLogin).toHaveBeenCalledTimes(2);
});
