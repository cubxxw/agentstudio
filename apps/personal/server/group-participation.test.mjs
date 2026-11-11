import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createPersonalServer } from './index.mjs';

let sequence = 0;
const key = () => `participation-${++sequence}`;
const profile = { agentId: 'codex', defaults: { provider: 'openai', model: 'test-model', thinking: 'low' }, models: [], providers: ['openai'], thinkingLevels: ['low'], version: 'fixture-1' };
async function fixture(t, execute = () => ({ action: 'silence', reason: '没有需要补充的内容' })) {
  const dir = await mkdtemp(join(tmpdir(), 'agentstudio-participation-'));
  const changes = new EventEmitter(), contexts = [];
  const app = await createPersonalServer({ dataDir: dir, port: 0, codexCommand: process.execPath,
    discoverLocalAgents: async () => ({ checkedAt: new Date().toISOString(), agents: [{ id: 'codex', name: 'Codex', installed: true, auth: { status: 'configured' }, execution: { supported: true }, profile }] }),
    executeLocalAgent: async input => {
      const context = JSON.parse(input.prompt.split('<untrusted_thread_context>\n')[1].split('\n</untrusted_thread_context>')[0]);
      contexts.push(context);
      const result = await execute(context, input);
      return { markdown: typeof result === 'string' ? result : JSON.stringify(result), identity: { agentId: 'codex' } };
    }, onChange: () => changes.emit('change') });
  await app.listen();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const api = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const wait = (id, predicate) => new Promise((resolve, reject) => {
    const check = () => { const thread = app.store.get('thread', id); if (predicate(thread)) { clearTimeout(timer); changes.off('change', check); resolve(thread); } };
    const timer = setTimeout(() => { changes.off('change', check); reject(new Error(`Timed out: ${JSON.stringify(app.store.get('thread', id)?.runs)}`)); }, 5000);
    changes.on('change', check); check();
  });
  await api('/contacts');
  return { app, api, wait, contexts };
}
const contact = async (f, handle) => (await f.api('/contacts', { kind: 'agent', name: handle, handle, instructions: `职责 ${handle}`, binding: { type: 'local', localAgentId: 'codex' }, clientId: key() })).body;
const group = async (f, members) => (await f.api('/chats', { kind: 'group', title: '协作', memberIds: members, clientId: key() })).body;
const send = (f, chat, text, extra = {}) => f.api(`/threads/${chat.id}/messages`, { text, clientId: key(), ...extra });

test('default group delivery lets each member choose a real reply or silence without creating phantom messages', async t => {
  const f = await fixture(t, context => context.agentIdentity.handle === 'researcher' ? { action: 'reply', text: '我来核对来源。' } : { action: 'silence', reason: '让负责研究的伙伴回答。' });
  const a = await contact(f, 'researcher'), b = await contact(f, 'writer');
  const chat = await group(f, [a.id, b.id]);
  const result = await send(f, chat, '这个资料的来源可靠吗？');
  assert.equal(result.body.runs.length, 2);
  const done = await f.wait(chat.id, x => x.runs.length === 2 && x.runs.every(r => r.status === 'completed'));
  assert.equal(done.messages.filter(m => m.role === 'user').length, 1);
  assert.deepEqual(done.messages.filter(m => m.role === 'assistant').map(m => m.text), ['我来核对来源。']);
  assert.equal(done.artifacts.length, 1);
  assert.deepEqual(done.runs.find(r => r.contactId === b.id).participation, { action: 'silence', reason: '让负责研究的伙伴回答。' });
  assert.equal(done.runs.find(r => r.contactId === b.id).progress, undefined);
  assert.equal(done.runs[0].responsePolicy, 'auto');
  assert.equal(f.contexts.length, 2, 'assistant reply does not recursively invoke agents');
  assert.equal(f.contexts[0].attention.explicitlyAddressed, false);
});

test('precise addressing and reply attention are frozen with the run and survive retry', async t => {
  const f = await fixture(t, () => ({ action: 'reply', text: '收到。' }));
  const a = await contact(f, 'researcher'), b = await contact(f, 'writer');
  const chat = await group(f, [a.id, b.id]);
  await send(f, chat, '@researcher，请先核对；@writer-too 不是 writer');
  let done = await f.wait(chat.id, x => x.runs.length === 2 && x.runs.every(r => r.status === 'completed'));
  assert.equal(f.contexts[0].attention.explicitlyAddressed, true);
  assert.equal(f.contexts[1].attention.explicitlyAddressed, false);
  assert.deepEqual(f.contexts[0].attention.addressedContactIds, [a.id]);
  const reply = done.messages.find(m => m.role === 'assistant' && m.contactId === b.id);
  await send(f, chat, '继续吧', { replyTo: reply.id });
  done = await f.wait(chat.id, x => x.runs.length === 4 && x.runs.every(r => r.status === 'completed'));
  assert.equal(f.contexts[2].attention.explicitlyAddressed, false);
  assert.equal(f.contexts[3].attention.replyToContactId, b.id);
  assert.equal(f.contexts[3].attention.explicitlyAddressed, true);
  const original = done.runs[0];
  f.app.store.updateThread(chat.id, x => { x.runs[0].status = 'blocked'; x.runs[0].error = 'Synthetic retry'; });
  await f.api(`/contacts/${a.id}`, { name: 'Renamed', handle: 'renamed', instructions: 'Changed', version: a.version, clientId: key() });
  await f.api(`/chats/${chat.id}`, { version: chat.version, responsePolicies: { [a.id]: 'mention' }, clientId: key() });
  await f.api(`/threads/${chat.id}/retry`, { runId: original.id, clientId: key() });
  const retried = await f.wait(chat.id, x => x.runs.length === 5 && x.runs[4].status === 'completed');
  assert.deepEqual(retried.runs[4].conversationSnapshot.attention, original.conversationSnapshot.attention);
  assert.equal(retried.runs[4].responsePolicy, 'auto');
  assert.equal(f.contexts.at(-1).agentIdentity.handle, 'researcher');
  assert.equal(f.contexts.at(-1).attention.explicitlyAddressed, true);
});

test('explicit mention and manual policies still control dispatch, while always keeps ordinary text output', async t => {
  const f = await fixture(t, context => context.responsePolicy === 'always' ? '始终回复的正文' : { action: 'silence', reason: '无需补充' });
  const a = await contact(f, 'researcher'), b = await contact(f, 'writer'), c = await contact(f, 'coordinator');
  const chat = await group(f, [a.id, b.id, c.id]);
  const policy = await f.api(`/chats/${chat.id}`, { version: chat.version, responsePolicies: { [a.id]: 'mention', [b.id]: 'manual', [c.id]: 'always' }, clientId: key() });
  assert.equal(policy.status, 200);
  await send(f, chat, '日常讨论');
  let done = await f.wait(chat.id, x => x.runs.length === 1 && x.runs[0].status === 'completed');
  assert.equal(done.runs[0].contactId, c.id);
  assert.equal(done.messages.at(-1).text, '始终回复的正文');
  await send(f, chat, '@all 大家看看');
  done = await f.wait(chat.id, x => x.runs.length === 3 && x.runs.every(r => r.status === 'completed'));
  assert.equal(done.runs.some(r => r.contactId === b.id), false);
});

test('protocol envelopes are not exposed as streamed text and malformed decisions remain failures', async t => {
  let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async (_context, input) => {
    input.onEvent({ type: 'progress', phase: 'writing', text: '{"action":"silence","reason":"尚未完整"' });
    entered(); await gate;
    return '{"action":"silence","text":"hidden reply"}';
  });
  const chat = await group(f, ['agent_codex']);
  await send(f, chat, '普通消息');
  await enteredPromise;
  const running = f.app.store.get('thread', chat.id);
  assert.equal(running.runs[0].progress?.text || '', '');
  release();
  const failed = await f.wait(chat.id, x => x.runs[0].status === 'blocked');
  assert.match(failed.runs[0].error, /参与|回复|格式/);
  assert.equal(failed.runs[0].participation, undefined);
  assert.equal(failed.messages.length, 1);
  assert.equal(failed.artifacts.length, 0);
});

test('autonomous delivery preserves post-join history boundaries and skips unavailable ambient members', async t => {
  const f = await fixture(t);
  const chat = await group(f, ['agent_codex']);
  await send(f, chat, 'PRIVATE_BEFORE_JOIN');
  await f.wait(chat.id, x => x.runs[0]?.status === 'completed');
  const later = await contact(f, 'later');
  const unavailable = f.app.store.put('contact', { id: 'agent_absent', kind: 'agent', name: 'Absent', handle: 'absent', description: '', instructions: '', version: 1, binding: { type: 'local', localAgentId: 'absent' } });
  await f.api(`/chats/${chat.id}`, { version: chat.version, memberIds: ['agent_codex', later.id, unavailable.id], clientId: key() });
  f.app.store.updateThread(chat.id, x => x.messages.push({ id: 'late-before-join', role: 'assistant', contactId: 'agent_codex', text: 'PRIVATE_LATE_REPLY', recipientIds: ['self', 'agent_codex'], createdAt: new Date().toISOString() }));
  const sent = await send(f, chat, '加入后的普通消息');
  assert.equal(sent.body.runs.length, 3);
  assert.equal(sent.body.messages.at(-1).skippedContacts[0].id, unavailable.id);
  await f.wait(chat.id, x => x.runs.length === 3 && x.runs.every(r => r.status === 'completed'));
  const received = f.contexts.find(context => context.agentIdentity.id === later.id);
  assert.ok(received);
  assert.ok(!JSON.stringify(received).includes('PRIVATE_BEFORE_JOIN'));
  assert.ok(!JSON.stringify(received).includes('PRIVATE_LATE_REPLY'));
  const rejected = await send(f, chat, '@absent 请回答');
  assert.equal(rejected.status, 409);
  assert.equal(f.app.store.get('thread', chat.id).messages.filter(m => m.role === 'user').length, 2);
});
