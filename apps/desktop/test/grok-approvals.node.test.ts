import { afterEach, expect, it, vi } from "vitest";
import { GrokBotConnector, GROK_DEFAULTS, type GrokClient } from "../src/main/connectors/grokbot";
vi.mock("electron", () => ({ shell: {}, app: {} }));
const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });
const entry = (answer?: string, updated = 1, options = [{ label: "Approve QA", value: "a" }, { label: "Reject QA", value: "r" }]) => ({ entry_id: "card", seq: 2, updated_seq: updated, entry_kind: "send-message", body: Buffer.from(JSON.stringify({ kind: "send-message", message: { type: "widget", widget: { prompt: "QA?", options } }, ...(answer ? { widgetAnswered: true, answer } : {}) })) });
async function fixture(personalTurn?: any, harness?: string) {
  let entries = [entry()]; const calls: any[] = [], cards: any[] = [], events: any[] = [];
  let live: any = { session_id: "session", last_turn_settlement: { turn_id: personalTurn?.providerMessageId, outcome: "success" } };
  let status: any;
  const agent = { id: "qa", name: "QA", description: "", sessionId: "session", harness };
  const client = { listAgents: async () => [agent], rpc: async (method: string, _schema: unknown, params: any) => {
    calls.push({ method, params });
    return method === "ListGrokBotTranscriptEntries" ? { entries } : method === "ListGrokBotAgentStatuses" ? { statuses: [status ?? { agent_id: "qa", live }] } : { accepted: true };
  } } as unknown as GrokClient;
  const connector = new GrokBotConnector({ ...GROK_DEFAULTS, pollActiveMs: 1_000_000, pollIdleMs: 1_000_000 }, { agent, machineId: "qa", accessToken: "fake", refreshToken: "fake", lastSeq: personalTurn ? 4 : 10, personalTurn }, client, () => {}, async () => null);
  stops.push(() => connector.stop());
  await connector.start({ emit: e => events.push(e), profileChanged: () => {}, approval: c => cards.push(c) });
  return { connector, cards, calls, events, setStatus: (value: any) => { status = value; }, setLive: (value: any) => { live = value; }, set: (value: typeof entries) => { entries = value; }, poll: () => (connector as any).tick() };
}
it("requires a known temporal running phase before idle can complete a stable reply", async () => {
  const f=await fixture(undefined,"temporal");f.set([]);await f.connector.send({session_id:"personal:qa",message_id:"turn",text:"QA",sent_at:new Date().toISOString()});
  const nonce=f.calls.find(c=>c.method==="SendGrokBotUserMessage").params.message_id;
  f.set([{entry_id:"t2u",seq:11,updated_seq:11,entry_kind:"user-message",body:Buffer.from(JSON.stringify({kind:"user-message",clientNonce:nonce,text:"QA"}))},{entry_id:"t2s0",seq:12,updated_seq:12,entry_kind:"send-message",body:Buffer.from(JSON.stringify({kind:"send-message",message:{text:"QA reply"}}))}]);
  f.setStatus({agent_id:"qa"});await f.poll();await f.poll();expect(f.events).not.toContainEqual({type:"status",state:"idle"});
  f.setStatus({agent_id:"qa",is_running:true});await f.poll();expect(f.events).not.toContainEqual({type:"status",state:"idle"});
  f.setStatus({agent_id:"different"});await f.poll();expect(f.events).not.toContainEqual({type:"status",state:"idle"});
  f.setStatus({agent_id:"qa"});await f.poll();expect(f.events).toContainEqual({type:"status",state:"idle"});
});
it("keeps a turn open when a stable preamble arrives before its native approval card", async () => {
  const f = await fixture(); f.set([]);
  await f.connector.send({ session_id: "personal:qa", message_id: "outbound", text: "QA", sent_at: new Date().toISOString() });
  const nonce = f.calls.find(c => c.method === "SendGrokBotUserMessage").params.message_id;
  const user = { entry_id: "user", seq: 11, updated_seq: 11, entry_kind: "user-message", body: Buffer.from(JSON.stringify({ kind: "user-message", clientNonce: nonce, text: "QA" })) };
  const preamble = { entry_id: "preamble", seq: 12, updated_seq: 12, entry_kind: "send-message", body: Buffer.from(JSON.stringify({ kind: "send-message", message: { text: "Waiting for your choice" } })) };
  f.setLive({ session_id: "session", is_running: true }); f.set([user, preamble]);
  await f.poll(); await f.poll();
  expect(f.events).not.toContainEqual({ type: "status", state: "idle" });
  const card = { ...entry(), seq: 13, updated_seq: 13 }; f.set([user, preamble, card]); await f.poll();
  expect(f.cards.at(-1)).toMatchObject({ state: "pending", replyTo: "outbound" });
  f.set([user, preamble, { ...entry("r", 15), seq: 13 }, { ...preamble, entry_id: "final", seq: 14, updated_seq: 14, body: Buffer.from(JSON.stringify({ kind: "send-message", message: { text: "Selected Reject QA" } })) }]);
  await f.poll(); await f.poll();
  expect(f.events).not.toContainEqual({ type: "status", state: "idle" });
  f.setLive({ session_id: "session", last_turn_settlement: { turn_id: "unrelated", outcome: "success" } }); await f.poll();
  expect(f.events).not.toContainEqual({ type: "status", state: "idle" });
  f.setLive({ session_id: "session", last_turn_settlement: { turn_id: nonce, outcome: "success" } }); await f.poll();
  expect(f.events).toContainEqual({ type: "status", state: "idle" });
  expect(f.events).toContainEqual(expect.objectContaining({ type: "message", reply_to: "outbound", text: "Selected Reject QA" }));
  expect(f.calls.filter(c => c.method === "SendGrokBotUserMessage")).toHaveLength(1);
});
it("publishes existing pending cards despite an older seq, with exact opaque choices", async () => {
  const f = await fixture(); const values = Array.from({ length: 6 }, (_, i) => ({ label: `Choice ${i}`, value: `${i}${"x".repeat(250)}` }));
  f.set([entry(undefined, 2, values)]); await f.poll();
  const card = f.cards.at(-1); expect(card.state).toBe("pending"); expect(card.choices).toHaveLength(6);
  expect(card.choices[5].key).not.toContain("xxx");
  await f.connector.decide("card", card.choices[5].key);
  expect(f.calls.filter(c => c.method === "RespondGrokBotWidget")[0].params.value).toBe(values[5]!.value);
});
it("does not settle pre-approval text when the first card snapshot is already answered", async () => {
 const f=await fixture();f.set([]);await f.connector.send({session_id:"personal:qa",message_id:"turn",text:"QA",sent_at:new Date().toISOString()});
 const nonce=f.calls.find(c=>c.method==="SendGrokBotUserMessage").params.message_id;
 const user={entry_id:"user",seq:11,updated_seq:11,entry_kind:"user-message",body:Buffer.from(JSON.stringify({kind:"user-message",clientNonce:nonce,text:"QA"}))};
 const text={entry_id:"preamble",seq:12,updated_seq:12,entry_kind:"send-message",body:Buffer.from(JSON.stringify({kind:"send-message",message:{text:"Waiting for your choice"}}))};
 f.setLive({session_id:"session",is_running:true});f.set([user,text]);await f.poll();await f.poll();
 f.setLive({session_id:"session",last_turn_settlement:{turn_id:nonce,outcome:"success"}});
 f.set([user,text,{...entry("r",15),seq:13}]);await f.poll();
 expect(f.events).not.toContainEqual({type:"status",state:"idle"});
 f.set([user,text,{...entry("r",15),seq:13},{...text,entry_id:"final",seq:14,updated_seq:14,body:Buffer.from(JSON.stringify({kind:"send-message",message:{text:"Selected Reject QA"}}))}]);await f.poll();await f.poll();
 expect(f.events).toContainEqual({type:"status",state:"idle"});
});
it("rechecks revisions before answering and observes answers made in the original app", async () => {
  const f = await fixture(); await f.poll(); const old = f.cards.at(-1);
  f.set([entry(undefined, 3)]);
  await expect(f.connector.decide("card", old.choices[0].key)).rejects.toThrow();
  expect(f.calls.filter(c => c.method === "RespondGrokBotWidget")).toHaveLength(0);
  f.set([entry("r", 4)]); await f.poll();
  expect(f.cards.at(-1)).toMatchObject({ id: "card", state: "resolved", choiceLabel: "Reject QA", source: "original" });
});
it("does not answer a card missing or omitted from the fresh read", async () => {
 const f=await fixture(); await f.poll();const choice=f.cards.at(-1).choices[0].key;
 f.set([]);await expect(f.connector.decide("card",choice)).rejects.toThrow();
 f.set([{...entry(),body:undefined,body_omitted:true} as any]);await expect(f.connector.decide("card",choice)).rejects.toThrow();
 expect(f.calls.filter(c=>c.method==="RespondGrokBotWidget")).toHaveLength(0);
});
it("restores a known pending turn and accepts an original-app answer after restart without resending", async () => {
 const turn={messageId:"original",providerMessageId:"nonce",text:"QA",echoed:true,startSeq:1,sessionId:"session",waiting:true,cards:["card"],resumeAfter:4};
 const f=await fixture(turn);
 f.set([entry("r",3),{entry_id:"reply",seq:5,updated_seq:1,entry_kind:"send-message",body:Buffer.from(JSON.stringify({kind:"send-message",message:{text:"Selected Reject QA"}}))}]);
 await f.poll();await f.poll();
 expect(f.events).toContainEqual(expect.objectContaining({type:"status",state:"working"}));
 expect(f.events).toContainEqual(expect.objectContaining({type:"message",reply_to:"original",text:"Selected Reject QA"}));
 expect(f.events).toContainEqual({type:"status",state:"idle"});
 expect(f.calls.some(c=>c.method==="SendGrokBotUserMessage")).toBe(false);
});
it("does not regress a resolved original-app card on a late older snapshot", async () => {
 const f=await fixture();await f.poll();f.set([entry("r",4)]);await f.poll();f.set([entry(undefined,3)]);await f.poll();
 expect(f.cards.at(-1)).toMatchObject({state:"resolved",choiceLabel:"Reject QA"});
});
it("reads the temporal harness respondedValue when a choice is made in Grok Bot", async () => {
 const f=await fixture(); await f.poll(); const pending=entry();
 f.set([{...pending,updated_seq:3,body:Buffer.from(JSON.stringify({...JSON.parse(pending.body.toString()),respondedValue:"r"}))}]); await f.poll();
 expect(f.cards.at(-1)).toMatchObject({state:"resolved",choiceLabel:"Reject QA",source:"original"});
});
it("reads a native dismissal with no response value", async () => {
 const f=await fixture();await f.poll();const p=entry();
 f.set([{...p,seq:11,updated_seq:11,body:Buffer.from(JSON.stringify({...JSON.parse(p.body.toString()),respondedValue:null,widgetDismissed:true}))}]);await f.poll();
 expect(f.cards.at(-1)).toMatchObject({state:"resolved",choiceLabel:"已跳过",source:"original"});
 expect(f.events.some(e=>e.type==="approval_request")).toBe(false);
});
it("reconciles a closed-app answer only from a new request in the same temporal turn", async () => {
 const turn={messageId:"original",providerMessageId:"nonce",text:"QA",echoed:true,startSeq:1,sessionId:"session",waiting:true,cards:["t1s1"],resumeAfter:4,resumeUpdated:4,temporalTurn:"t1",approvalRequests:["before"]};
 const f=await fixture(turn,"temporal");f.setStatus({agent_id:"qa"});
 const card={...entry("r",8),entry_id:"t1s1",seq:4};card.body=Buffer.from(JSON.stringify({...JSON.parse(card.body.toString()),requestId:"before"}));
 const pre={entry_id:"t1s2",seq:5,updated_seq:5,entry_kind:"send-message",body:Buffer.from(JSON.stringify({kind:"send-message",requestId:"before",message:{text:"Wait for choice"}}))};
 const user={entry_id:"t1u",seq:2,updated_seq:2,entry_kind:"user-message",body:Buffer.from(JSON.stringify({kind:"user-message",clientNonce:"nonce",text:"QA"}))};
 f.set([user,card,pre]);await f.poll();await f.poll();expect(f.events).not.toContainEqual({type:"status",state:"idle"});
 f.set([user,card,pre,{...pre,entry_id:"t1s3",seq:6,updated_seq:6,body:Buffer.from(JSON.stringify({kind:"send-message",requestId:"after",message:{text:"Selected Reject QA"}}))}]);await f.poll();await f.poll();
 expect(f.events).toContainEqual({type:"status",state:"idle"});expect(f.calls.some(c=>c.method==="SendGrokBotUserMessage")).toBe(false);
});
it("keeps the original turn while two cards are answered separately in Grok Bot", async () => {
 const turn={messageId:"original",providerMessageId:"nonce",text:"QA",echoed:true,startSeq:1,sessionId:"session",waiting:true,cards:["card","card2"],resumeAfter:4};
 const f=await fixture(turn), second={...entry(undefined,1),entry_id:"card2",seq:3};
 const user=(seq:number)=>({entry_id:`user${seq}`,seq,updated_seq:1,entry_kind:"user-message",body:Buffer.from(JSON.stringify({kind:"user-message",text:"r"}))});
 f.set([entry("r",2),second,user(5)]);await f.poll();
 expect((f.connector as any).personalReply?.messageId).toBe("original");
 expect(f.events.some(e=>e.type==="message"&&e.from_user)).toBe(false);
 expect(f.events.some(e=>e.type==="status"&&e.state==="working")).toBe(false);
 f.set([entry("r",2),{...entry("r",2),entry_id:"card2",seq:3},user(5),user(6)]);await f.poll();
 expect((f.connector as any).personalReply?.messageId).toBe("original");
 expect(f.events.filter(e=>e.type==="status"&&e.state==="working")).toHaveLength(1);
 expect(f.events.some(e=>e.type==="message"&&e.from_user)).toBe(false);
});
it("does not carry an independent answer into a later turn or suppress an unrelated nonce", async () => {
 const f=await fixture();await f.poll();await f.connector.decide("card",f.cards.at(-1).choices[1].key);
 expect((f.connector as any).widgetAnswers.size).toBe(0);
 (f.connector as any).personalReply={messageId:"new",providerMessageId:"newnonce",text:"new prompt",echoed:true,startSeq:10,sessionId:"session",cards:[]};
 (f.connector as any).rememberWidgetAnswer("relatedcard","r");
 f.set([{entry_id:"foreign",seq:11,updated_seq:1,entry_kind:"user-message",body:Buffer.from(JSON.stringify({kind:"user-message",clientNonce:"foreignnonce",text:"r"}))}]);await f.poll();
 expect(f.events).toContainEqual(expect.objectContaining({type:"message",from_user:true,text:"r"}));
 expect((f.connector as any).personalReply).toBeNull();
});
