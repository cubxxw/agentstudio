import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonalStore } from './store.mjs';
import { Messenger } from './messenger.mjs';
import { Playrooms } from './playrooms.mjs';
import { GroupSharing } from './group-sharing.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'integrated-groups-')), store = new PersonalStore(dir), messenger = new Messenger(store);
  const profile = { agentId: 'codex', defaults: { provider: 'openai', model: 'fixture', thinking: 'medium' }, models: [], providers: ['openai'], thinkingLevels: ['medium'], version: 'fixture' };
  store.put('contact', { id: 'agent_codex', name: 'Codex', kind: 'agent', discovered: true, binding: { type: 'local', localAgentId: 'codex' }, availability: 'ready', profile, version: 1 });
  store.put('contact', { id: 'agent_fixture', name: '旅行规划', handle: 'planner', kind: 'agent', instructions: 'PRIVATE_PERSONA', description: '旅行分工', binding: { type: 'local', localAgentId: 'codex' }, availability: 'ready', configuration: {}, profile, version: 1 });
  const thread = messenger.createChat({ kind: 'group', title: '朋友的旅行', memberIds: ['agent_fixture'] });
  thread.messages.push({ id: 'private_before', role: 'user', contactId: 'self', text: 'PRIVATE_OLD_HISTORY', createdAt: new Date().toISOString() }); thread.memoryIds = ['private_memory']; store.put('thread', thread);
  store.put('memory', { id: 'private_memory', text: 'PRIVATE_MEMORY' });
  const validateInput = body => ({ text: body.text || '', attachments: body.attachments || [], memoryIds: body.memoryIds || [], mode: body.mode || 'codex', localAgentId: body.localAgentId || 'codex' });
  const sharing = new GroupSharing(store, { messenger, validateInput, kick: () => {}, notify: () => {} }); await sharing.listen();
  t.after(async () => { await sharing.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${sharing.server.address().port}`;
  const request = async (path, body, cookie) => { const r = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', Origin: origin }), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }; };
  const prepare = (extra = {}) => sharing.prepare(thread.id, { clientId: crypto.randomUUID(), brief: '公开的周末预算', hostName: '小熊', agents: [{ contactId: 'agent_fixture', persona: 'PUBLIC_PERSONA' }], ...extra });
  const publish = () => { const info = sharing.info(thread.id, 'self'); return sharing.publish(thread.id, { clientId: crypto.randomUUID(), version: info.share.version }); };
  const enter = async (nickname = '朋友', clientId = crypto.randomUUID()) => request('/g-api/join', { invite: sharing.invitation(sharing.info(thread.id, 'self').id).token, nickname, clientId });
  return { store, messenger, sharing, thread, request, prepare, publish, enter };
}
test('sharing is a permission on an existing group and a draft reveals no context', async t => {
  const f = await fixture(t), prepared = f.prepare(); assert.equal(prepared.threadId, f.thread.id); assert.equal(f.store.list('thread').length, 1);
  const grant = f.store.require('play_room', prepared.id), token = f.store.vault.authorization(grant.credential).Authorization.slice(7);
  assert.equal((await f.request('/g-api/preview', { invite: token })).status, 403);
  f.publish(); const preview = await f.request('/g-api/preview', { invite: token }); assert.equal(preview.status, 200); assert.equal(preview.body.brief, '公开的周末预算'); assert.ok(!JSON.stringify(preview.body).includes('PRIVATE'));
});
test('an accepted visitor writes the same canonical thread and worker run with public context only', async t => {
  const f = await fixture(t); f.prepare(); f.publish(); const a = await f.enter();
  assert.equal(a.status, 201); const actor = a.body.me.id; assert.ok(f.store.require('thread', f.thread.id).memberIds.includes(actor)); assert.equal(f.store.require('contact', actor).kind, 'human');
  const body = { type: 'message', text: '一起出发', clientId: crypto.randomUUID() };
  assert.equal((await f.request(`/g-api/${a.body.id}/actions`, body, a.cookie)).status, 200); await f.request(`/g-api/${a.body.id}/actions`, body, a.cookie);
  const thread = f.store.require('thread', f.thread.id), message = thread.messages.find(m => m.text === '一起出发'), run = thread.runs[0];
  assert.equal(message.contactId, actor); assert.equal(thread.runs.length, 1); assert.equal(f.store.list('play_job').length, 0);
  assert.equal(run.sharedGroup.actorId, actor); assert.equal(run.contactSnapshot.instructions, 'PUBLIC_PERSONA'); assert.deepEqual(run.memoryIds, []);
  assert.ok(!JSON.stringify(f.sharing.contextForRun(thread, run)).includes('PRIVATE'));
  const current = await f.request(`/g-api/${a.body.id}`, undefined, a.cookie); assert.equal(current.body.thread.id, f.thread.id); assert.ok(current.body.thread.messages.some(m => m.id === message.id)); assert.ok(!JSON.stringify(current.body).includes('PRIVATE'));
});
test('owner normal-message entry obeys the exact same public scope', async t => {
  const f = await fixture(t); f.prepare(); f.publish();
  f.messenger.appendMessage(f.store.require('thread', f.thread.id), { text: '主人在群里发言' }, body => ({ text: body.text, mode: body.mode, localAgentId: 'codex', attachments: [], memoryIds: [] }));
  const thread = f.store.require('thread', f.thread.id); assert.equal(thread.runs[0].sharedGroup.actorId, 'self'); assert.equal(thread.runs[0].contactSnapshot.instructions, 'PUBLIC_PERSONA'); assert.ok(!JSON.stringify(f.sharing.contextForRun(thread, thread.runs[0])).includes('PRIVATE'));
});
test('same-named humans remain distinct, retry uses one seat, removed guest cannot impersonate owner or publish late output', async t => {
  const f = await fixture(t); f.prepare({ maxGuests: 2 }); f.publish(); const key = crypto.randomUUID(), a = await f.enter('小熊', key), again = await f.enter('小熊', key), b = await f.enter('小熊');
  assert.equal(a.body.me.id, again.body.me.id); assert.notEqual(a.body.me.id, b.body.me.id); assert.equal((await f.enter()).status, 429);
  assert.equal((await f.request(`/g-api/${b.body.id}/actions`, { type: 'message', text: '伪造', actorId: 'self', clientId: crypto.randomUUID() }, b.cookie)).status, 400);
  await f.request(`/g-api/${b.body.id}/actions`, { type: 'message', text: '等待', clientId: crypto.randomUUID() }, b.cookie);
  const thread = f.store.require('thread', f.thread.id), oldToken = f.sharing.invitation(b.body.id).token;
  f.sharing.action(b.body.id, 'self', { type: 'remove', participantId: b.body.me.id, clientId: crypto.randomUUID() });
  assert.equal((await f.request(`/g-api/${b.body.id}`, undefined, b.cookie)).status, 401); assert.equal(f.sharing.canPublishRun(thread, thread.runs[0]), false); assert.notEqual(f.sharing.invitation(b.body.id).token, oldToken);
});
test('legacy rooms migrate once into ordinary groups without replaying jobs or discarding messages', async t => {
  const f = await fixture(t), legacy = new Playrooms(f.store);
  const old = legacy.create({ template: 'twin', title: '旧会客厅', brief: '已公开背景', persona: '已公开角色', clientId: crypto.randomUUID() }, { kind: 'agent', binding: { type: 'local', localAgentId: 'codex' } });
  const saved = f.store.require('play_room', old.id); saved.messages.push({ id: 'old_message', actorId: 'self', role: 'user', name: '主人', text: '旧公开消息', createdAt: new Date().toISOString() }); f.store.put('play_room', saved);
  f.sharing.migrate(); const mapped = f.store.require('play_room', old.id); assert.ok(mapped.threadId); assert.equal(f.store.require('thread', mapped.threadId).kind, 'group'); assert.ok(f.store.require('thread', mapped.threadId).messages.some(m => m.id === 'old_message'));
  const count = f.store.list('thread').length; f.sharing.migrate(); assert.equal(f.store.list('thread').length, count); assert.equal(f.store.list('play_job').length, 0); await legacy.close();
});
