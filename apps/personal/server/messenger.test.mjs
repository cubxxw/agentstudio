import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { createPersonalServer } from './index.mjs';

let sequence = 0;
const key = () => `messenger-test-${++sequence}`;
const detected = { checkedAt: new Date().toISOString(), agents: [
  { id: 'codex', name: 'Codex', installed: true, auth: { status: 'configured' }, execution: { supported: true } },
  { id: 'pi', name: 'Pi', installed: true, auth: { status: 'unknown' }, execution: { supported: false, reason: '尚未支持执行' } },
] };
const fake = `let p='';for await(const c of process.stdin)p+=c;let x=JSON.parse(p.split('<untrusted_thread_context>\\n')[1].split('\\n</untrusted_thread_context>')[0]);if(p.includes('planning ONE explicit MCP'))x={toolName:'echo',arguments:{text:JSON.stringify(x)}};console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(p.includes('Group participation:')?{action:'reply',text:JSON.stringify(x)}:x)}}));console.log(JSON.stringify({type:'turn.completed'}));`;
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agentstudio-messenger-'));
  const changes = new EventEmitter(); let app;
  const start = async () => {
    app = await createPersonalServer({ dataDir: dir, port: 0, codexCommand: process.execPath,
      codexArgs: ['--input-type=module', '-e', fake], discoverLocalAgents: async () => detected,
      onChange: () => changes.emit('change') });
    await app.listen();
  };
  await start();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const api = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const wait = (id, predicate) => new Promise((resolve, reject) => {
    const check = () => { const thread = app.store.get('thread', id); if (predicate(thread)) { clearTimeout(timer); changes.off('change', check); resolve(thread); } };
    const timer = setTimeout(() => { changes.off('change', check); reject(new Error(`Timed out ${JSON.stringify(app.store.get('thread', id)?.runs)}`)); }, 5000);
    changes.on('change', check); check();
  });
  await api('/contacts');
  return { api, wait, get store() { return app.store; }, async restart() { await app.close(); await start(); } };
}

// These regression cases exercise the retained explicit-addressing policy.
// Default autonomous participation has its own behavior tests.
async function legacyGroup(f, body) {
  const chat = (await f.api('/chats', body)).body;
  const responsePolicies = Object.fromEntries(chat.memberIds.filter(id => id !== 'self').map(id => [id, 'mention']));
  return (await f.api(`/chats/${chat.id}`, { version: chat.version, responsePolicies, clientId: key() })).body;
}

test('discovery, custom identities, stable direct chats and local-only people survive restart', async t => {
  const f = await fixture(t);
  const contacts = (await f.api('/contacts')).body.contacts;
  assert.ok(contacts.some(c => c.id === 'agent_codex' && c.availability === 'ready'));
  assert.ok(contacts.some(c => c.id === 'agent_pi' && c.availability === 'unsupported'));
  const body = { clientId: key(), kind: 'agent', name: '研究员', handle: 'researcher', instructions: '先核对来源', binding: { type: 'local', localAgentId: 'codex' } };
  const created = await f.api('/contacts', body);
  assert.equal(created.status, 201);
  assert.deepEqual((await f.api('/contacts', body)).body, created.body);
  assert.equal((await f.api('/contacts', { ...body, name: 'changed' })).status, 409);
  assert.equal((await f.api('/contacts', { ...body, clientId: key() })).status, 409);
  const contact = created.body;
  const chat = (await f.api('/chats', { kind: 'direct', memberIds: [contact.id], clientId: key() })).body;
  const again = (await f.api('/chats', { kind: 'direct', memberIds: [contact.id], clientId: key() })).body;
  assert.equal(chat.id, again.id); assert.equal(chat.runs.length, 0);
  const person = (await f.api('/contacts', { kind: 'human', name: '朋友', handle: 'friend', clientId: key() })).body;
  assert.equal(person.availability, 'local_only');
  const humanChat = (await f.api('/chats', { kind: 'direct', memberIds: [person.id], clientId: key() })).body;
  const humanMessage = await f.api(`/threads/${humanChat.id}/messages`, { text: '本地备忘', clientId: key() });
  assert.equal(humanMessage.body.runs.length, 0);
  assert.equal(humanMessage.body.messages[0].deliveryState, 'local_only');
  await f.restart();
  assert.equal((await f.api(`/contacts/${contact.id}`)).body.instructions, '先核对来源');
  assert.equal((await f.api(`/threads/${chat.id}`)).body.id, chat.id);
});

test('group mentions target exact members, each user message is stored once and accepted identities stay fixed', async t => {
  const f = await fixture(t);
  const a = (await f.api('/contacts', { kind: 'agent', name: 'Ada', handle: 'ada', instructions: 'Original identity', binding: { type: 'local', localAgentId: 'codex' }, clientId: key() })).body;
  const b = (await f.api('/contacts', { kind: 'agent', name: 'Bo', handle: 'bo', binding: { type: 'local', localAgentId: 'codex' }, clientId: key() })).body;
  const chat = await legacyGroup(f, { kind: 'group', title: '讨论', memberIds: [a.id, b.id], clientId: key() });
  const quiet = (await f.api(`/threads/${chat.id}/messages`, { text: 'Ambient message', clientId: key() })).body;
  assert.equal(quiet.runs.length, 0);
  assert.equal((await f.api(`/threads/${chat.id}/messages`, { text: '@adams 不应唤起 Ada', clientId: key() })).body.runs.length, 0);
  const input = { text: '@ada，@bo 一起看看', clientId: key() };
  const sent = await f.api(`/threads/${chat.id}/messages`, input);
  assert.equal(sent.body.runs.length, 2);
  assert.equal(sent.body.messages.filter(m => m.text === input.text).length, 1);
  assert.equal((await f.api(`/threads/${chat.id}/messages`, input)).body.runs.length, 2);
  await f.api(`/contacts/${a.id}`, { ...a, name: 'Updated', instructions: 'New identity', version: a.version, clientId: key() });
  const done = await f.wait(chat.id, x => x.runs.every(r => r.status === 'completed'));
  assert.equal(done.runs[0].contactSnapshot.name, 'Ada');
  assert.equal(done.runs[0].contactSnapshot.instructions, 'Original identity');
  assert.deepEqual(done.messages.filter(m => m.role === 'assistant').map(m => m.contactId).sort(), [a.id, b.id].sort());
  const returned = done.messages.find(m => m.role === 'assistant' && m.contactId === a.id);
  assert.equal(JSON.parse(returned.text).agentIdentity.name, 'Ada');
  assert.equal((await f.api(`/threads/${chat.id}/messages`, { text: '@pi outsider', clientId: key() })).body.runs.length, 2);
});

test('new members cannot see earlier messages, identity and membership updates use versions', async t => {
  const f = await fixture(t);
  const chat = await legacyGroup(f, { kind: 'group', title: 'Privacy', memberIds: ['agent_codex'], clientId: key() });
  await f.api(`/threads/${chat.id}/messages`, { text: 'BEFORE_JOIN_PRIVATE', clientId: key() });
  const b = (await f.api('/contacts', { kind: 'agent', name: 'Later', handle: 'later', binding: { type: 'local', localAgentId: 'codex' }, clientId: key() })).body;
  const updated = await f.api(`/chats/${chat.id}`, { version: chat.version, memberIds: [...chat.memberIds, b.id], clientId: key() });
  assert.equal(updated.status, 200);
  f.store.updateThread(chat.id, item => item.messages.push({ id: 'synthetic-late-reply', role: 'assistant', contactId: 'agent_codex',
    text: 'LATE_REPLY_FROM_BEFORE_JOIN', recipientIds: ['self', 'agent_codex'], createdAt: new Date().toISOString(), attachments: [] }));
  assert.equal((await f.api(`/chats/${chat.id}`, { version: chat.version, title: 'stale', clientId: key() })).status, 409);
  await f.api(`/threads/${chat.id}/messages`, { text: '@later 现在加入', clientId: key() });
  const done = await f.wait(chat.id, x => x.runs.at(-1)?.status === 'completed');
  const response = done.messages.find(m => m.role === 'assistant' && m.contactId === b.id);
  assert.ok(!response.text.includes('BEFORE_JOIN_PRIVATE'));
  assert.ok(!response.text.includes('LATE_REPLY_FROM_BEFORE_JOIN'));
  assert.equal((await f.api('/chats', { kind: 'direct', memberIds: ['agent_codex', b.id], clientId: key() })).status, 400);
});

test('group approvals stay independent and remote previews include scoped identity and conversation', async t => {
  const f = await fixture(t); let submissions = 0;
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    const rpc = JSON.parse(text); submissions++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { kind: 'message', role: 'agent', messageId: 'synthetic', parts: [{ kind: 'text', text: 'Synthetic approved reply' }] } }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const connection = (await f.api('/connections', { name: 'Synthetic', type: 'a2a', url: `http://127.0.0.1:${server.address().port}/rpc` })).body;
  const a = (await f.api('/contacts', { kind: 'agent', name: 'Remote A', handle: 'remote-a', binding: { type: 'connection', connectionId: connection.id }, clientId: key() })).body;
  const chat = await legacyGroup(f, { kind: 'group', title: 'Approvals', memberIds: [a.id, 'agent_codex'], clientId: key() });
  await f.api(`/threads/${chat.id}/messages`, { text: '@remote-a Please help', clientId: key() });
  const pending = await f.wait(chat.id, x => x.decisions.length === 1);
  const decision = pending.decisions[0];
  assert.equal(submissions, 0);
  assert.equal(JSON.parse(decision.preview).content.context.agentIdentity.name, a.name);
  await f.api(`/threads/${chat.id}/messages`, { text: '@codex Local independent reply', clientId: key() });
  const independent = await f.wait(chat.id, x => x.runs.at(-1)?.status === 'completed');
  assert.equal(independent.decisions[0].state, 'pending');
  const approvals = (await f.api('/approvals')).body.approvals;
  assert.equal(approvals[0].threadId, chat.id);
  const body = { choice: 'approve', version: decision.version, clientId: key() };
  assert.equal((await f.api(`/decisions/${decision.id}`, body)).status, 200);
  await f.wait(chat.id, x => x.runs[0].status === 'completed');
  await f.api(`/decisions/${decision.id}`, body);
  assert.equal(submissions, 1);
  assert.equal((await f.api(`/decisions/${decision.id}`, { ...body, clientId: key() })).status, 409);
});

test('broadcast skips unavailable members, but explicit unavailable targets reject without consuming the message', async t => {
  const f = await fixture(t);
  const chat = await legacyGroup(f, { kind: 'group', title: 'Broadcast', memberIds: ['agent_codex', 'agent_pi'], clientId: key() });
  const sent = (await f.api(`/threads/${chat.id}/messages`, { text: '@all 一起看看', clientId: key() })).body;
  assert.equal(sent.messages.length, 1); assert.equal(sent.runs.length, 1);
  assert.equal(sent.runs[0].contactId, 'agent_codex');
  assert.equal(sent.messages[0].skippedContacts[0].id, 'agent_pi');
  assert.equal((await f.api(`/threads/${chat.id}/messages`, { text: '@pi 你来', clientId: key() })).status, 409);
  assert.equal((await f.api(`/threads/${chat.id}`)).body.messages.filter(m => m.role === 'user').length, 1);
});

test('retry preserves the accepted identity and scope after contact changes', async t => {
  const f = await fixture(t);
  const original = (await f.api('/contacts/agent_codex')).body;
  const chat = (await f.api('/chats', { kind: 'direct', memberIds: [original.id], clientId: key() })).body;
  await f.api(`/threads/${chat.id}/messages`, { text: 'Original request', clientId: key() });
  const done = await f.wait(chat.id, x => x.runs[0]?.status === 'completed');
  f.store.updateThread(chat.id, x => { x.runs[0].status = 'blocked'; x.runs[0].error = 'Synthetic pre-dispatch retry'; });
  await f.api(`/contacts/${original.id}`, { name: 'Renamed', instructions: 'New instructions', version: original.version, clientId: key() });
  await f.api(`/threads/${chat.id}/retry`, { runId: done.runs[0].id, clientId: key() });
  const retried = await f.wait(chat.id, x => x.runs[1]?.status === 'completed');
  assert.deepEqual(retried.runs[1].contactSnapshot, done.runs[0].contactSnapshot);
  assert.equal(retried.messages.filter(m => m.role === 'user').length, 1);
  assert.equal(JSON.parse(retried.messages.at(-1).text).agentIdentity.name, original.name);
});

test('reply wakes the author, paused agents stay quiet, and @all does not replay an uncertain lane', async t => {
  const f = await fixture(t);
  const other = (await f.api('/contacts', { kind: 'agent', name: 'Other', handle: 'other', binding: { type: 'local', localAgentId: 'codex' }, clientId: key() })).body;
  const chat = await legacyGroup(f, { kind: 'group', title: 'Reply', memberIds: [other.id, 'agent_codex'], clientId: key() });
  await f.api(`/threads/${chat.id}/messages`, { text: '@other first', clientId: key() });
  const first = await f.wait(chat.id, x => x.runs[0]?.status === 'completed');
  const replyId = first.messages.at(-1).id;
  await f.api(`/threads/${chat.id}/messages`, { text: 'Continue', replyTo: replyId, clientId: key() });
  const continued = await f.wait(chat.id, x => x.runs[1]?.status === 'completed');
  assert.equal(continued.runs[1].contactId, other.id);
  f.store.updateThread(chat.id, x => { x.runs[1].status = 'unknown'; x.runs[1].requiresReconciliation = true; });
  await f.api(`/threads/${chat.id}/messages`, { text: '@all new independent request', clientId: key() });
  const independent = await f.wait(chat.id, x => x.runs.at(-1)?.contactId === 'agent_codex' && x.runs.at(-1).status === 'completed');
  assert.equal(independent.runs.filter(r => r.contactId === other.id).length, 2);
  await f.api(`/chats/${chat.id}`, { version: chat.version, responsePolicies: { [other.id]: 'manual' }, clientId: key() });
  const paused = (await f.api(`/threads/${chat.id}/messages`, { text: '@other stay paused', replyTo: replyId, clientId: key() })).body;
  assert.equal(paused.runs.length, independent.runs.length);
});

test('a newly joined MCP agent reaches approval with only its post-join context', async t => {
  const f = await fixture(t);
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    const rpc = JSON.parse(text);
    if (rpc.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
    const result = rpc.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Synthetic MCP', version: '1' } }
      : { tools: [{ name: 'echo', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } }] };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const chat = await legacyGroup(f, { kind: 'group', title: 'MCP privacy', memberIds: ['agent_codex'], clientId: key() });
  await f.api(`/threads/${chat.id}/messages`, { text: 'PRIVATE_BEFORE_MCP', clientId: key() });
  const connection = (await f.api('/connections', { name: 'MCP', type: 'mcp', url: `http://127.0.0.1:${server.address().port}/rpc` })).body;
  const member = (await f.api('/contacts', { kind: 'agent', name: 'MCP member', handle: 'mcp-member', binding: { type: 'connection', connectionId: connection.id }, clientId: key() })).body;
  await f.api(`/chats/${chat.id}`, { version: chat.version, memberIds: ['agent_codex', member.id], clientId: key() });
  await f.api(`/threads/${chat.id}/messages`, { text: '@mcp-member hello', clientId: key() });
  const pending = await f.wait(chat.id, x => x.decisions.length === 1 || x.runs.at(-1)?.status === 'blocked');
  assert.equal(pending.runs.at(-1).status, 'needs_input', pending.runs.at(-1).error);
  assert.ok(!pending.decisions[0].preview.includes('PRIVATE_BEFORE_MCP'));
  assert.ok(pending.decisions[0].preview.includes('MCP member'));
});
