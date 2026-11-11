import { afterEach, expect, it, vi } from "vitest";
import { GrokBotConnector, GrokClient, GROK_DEFAULTS, type GrokData } from "../src/main/connectors/grokbot";

afterEach(()=>vi.unstubAllGlobals());
it("keeps each bot's saved agent, transcript cursor and approval turn separate from shared account tokens", async () => {
  const cfg={...GROK_DEFAULTS,pollActiveMs:1000,pollIdleMs:1000};
  const first:GrokData={accessToken:"synthetic-access",refreshToken:"synthetic-refresh",machineId:"account",agent:{id:"first",name:"First",description:"",sessionId:"s1"},lastSeq:100};
  const second:GrokData={...first,agent:{id:"second",name:"Second",description:"",sessionId:"s2"},lastSeq:9,personalTurn:{messageId:"original",providerMessageId:"nonce",text:"QA",echoed:true,startSeq:1,sessionId:"s2",waiting:true,cards:["card"]}};
  const client=new GrokClient(cfg,first,"account",()=>{});
  const connector=new GrokBotConnector(cfg,second,client,()=>{},async()=>null);
  const saved=JSON.parse(JSON.stringify(connector.serialize()));
  expect(saved.agent).toEqual({id:"second",name:"Second",description:"",sessionId:"s2"});
  expect(saved.lastSeq).toBe(9);expect(saved.personalTurn).toMatchObject({messageId:"original",waiting:true,cards:["card"]});
  expect(client.currentTokens).toEqual({accessToken:"synthetic-access",refreshToken:"synthetic-refresh"});
  const reloaded=new GrokBotConnector(cfg,saved,client,()=>{},async()=>null);
  expect(reloaded.serialize()).toMatchObject({agent:{id:"second",sessionId:"s2"},lastSeq:9,personalTurn:{messageId:"original",waiting:true}});
  let reads=0;
  vi.stubGlobal("fetch",vi.fn(async(input:string)=>input.endsWith("/oauth/token")?Response.json({access_token:"new-access",refresh_token:"new-refresh"}):++reads===1?new Response("{}",{status:401}):new Response(new Uint8Array())));
  await client.rpc("SyntheticRead",[],{},[]);
  expect(reloaded.serialize()).toMatchObject({accessToken:"new-access",refreshToken:"new-refresh",agent:{id:"second",sessionId:"s2"},lastSeq:9,personalTurn:{messageId:"original",waiting:true}});
});
