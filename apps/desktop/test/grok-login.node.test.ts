import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { grokLogin, GrokClient, GROK_DEFAULTS } from "../src/main/connectors/grokbot";
const cfg={...GROK_DEFAULTS,pollActiveMs:2000,pollIdleMs:5000};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const agents=[{id:"synthetic-agent",name:"QA",description:"",sessionId:"synthetic-session"}];
it("publishes only the original PKCE start URL and receives a receipt while browser opening is stalled",async()=>{
 let started="",pollURL="";const abort=new AbortController();
 vi.spyOn(GrokClient.prototype,"listAgents").mockResolvedValue(agents);
 vi.stubGlobal("fetch",vi.fn(async(url:URL)=>{pollURL=String(url);return new Response(JSON.stringify({accessToken:"synthetic-access",refreshToken:"synthetic-refresh"}));}));
 const result=await grokLogin(cfg,async()=>new Promise<void>(()=>{}),abort.signal,{onStart:view=>{started=view.url;}});
 expect(result.agents).toEqual(agents);
 const link=new URL(started),poll=new URL(pollURL);
 expect(link.pathname).toBe("/loginDeepControl");expect(link.searchParams.get("uuid")).toBe(poll.searchParams.get("uuid"));
 expect(link.searchParams.get("challenge")).toBe(createHash("sha256").update(poll.searchParams.get("verifier")!).digest("base64url"));
 expect([...link.searchParams.keys()]).not.toContain("verifier");expect(started).not.toContain("synthetic-access");
});
it("retries a bounded request timeout without generating another sign-in request",async()=>{
 vi.useFakeTimers();const views:string[]=[];
 vi.spyOn(GrokClient.prototype,"listAgents").mockResolvedValue(agents);
 const fetcher=vi.fn().mockRejectedValueOnce(new DOMException("timed out","TimeoutError")).mockResolvedValue(new Response(JSON.stringify({accessToken:"synthetic-access",refreshToken:"synthetic-refresh"})));
 vi.stubGlobal("fetch",fetcher);
 const result=grokLogin(cfg,async()=>{},new AbortController().signal,{onStart:view=>views.push(view.url)});
 await vi.advanceTimersByTimeAsync(1000);await expect(result).resolves.toMatchObject({agents});
 expect(views).toHaveLength(1);expect(String(fetcher.mock.calls[0]![0])).toBe(String(fetcher.mock.calls[1]![0]));
});
it("closes the owned launch scope after a verified receipt",async()=>{
 let launchSignal:AbortSignal|undefined;
 vi.spyOn(GrokClient.prototype,"listAgents").mockResolvedValue(agents);
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({accessToken:"synthetic-access",refreshToken:"synthetic-refresh"}))));
 await grokLogin(cfg,async(_url,signal)=>{launchSignal=signal;},new AbortController().signal);
 expect(launchSignal?.aborted).toBe(true);
});
it("rejects an account response that arrives after cancellation",async()=>{
 const abort=new AbortController();let finish!: (value: typeof agents)=>void;
 const pending=new Promise<typeof agents>(resolve=>{finish=resolve;});
 vi.spyOn(GrokClient.prototype,"listAgents").mockReturnValue(pending);
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({accessToken:"synthetic-access"}))));
 const result=grokLogin(cfg,async()=>{},abort.signal);const check=expect(result).rejects.toThrow("cancelled");
 await vi.waitFor(()=>expect(GrokClient.prototype.listAgents).toHaveBeenCalled());abort.abort();finish(agents);await check;
});
