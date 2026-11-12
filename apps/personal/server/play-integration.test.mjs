import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersonalServer } from './index.mjs';

test('trusted workspace manages rooms while separate guest listener rejects owner API', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'play-host-'));
  const host = await createPersonalServer({ autoGroupNetwork: false, dataDir: dir, port: 0, discoverLocalAgents: async () => ({ agents: [] }), playExecute: async () => '真实测试传输' }); await host.listen();
  t.after(async () => { await host.close(); await rm(dir, { recursive: true, force: true }); });
  host.store.put('contact', { id: 'agent_test', kind: 'agent', name: '测试助手', binding: { type: 'local', localAgentId: 'codex' }, configuration: {} });
  const api = async (path, body) => { const response = await fetch(`http://127.0.0.1:${host.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, body: await response.json() }; };
  const created = await api('/playrooms', { template: 'twin', title: '会客厅', brief: '仅公开背景', persona: '清楚说明自己是AI', contactId: 'agent_test', clientId: crypto.randomUUID() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const invitation = await api(`/playrooms/${created.body.id}/invite`, {}); assert.equal(invitation.status, 200); assert.match(invitation.body.token, /^[A-Za-z0-9_-]{43}$/);
  const guestOrigin = new URL(invitation.body.localUrl).origin;
  assert.equal((await fetch(`${guestOrigin}/api/bootstrap`)).status, 404);
  assert.equal((await api('/playrooms')).body.rooms.length, 1);
  assert.ok(!JSON.stringify((await api(`/playrooms/${created.body.id}`)).body).includes(invitation.body.token));
});
test('workspace switching counts shared runs in the canonical worker ledger', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'play-blockers-'));
  const host = await createPersonalServer({ autoGroupNetwork: false, dataDir: dir, port: 0, discoverLocalAgents: async () => ({ agents: [] }) }); await host.listen();
  t.after(async () => { await host.close(); await rm(dir, { recursive: true, force: true }); });
  const room = host.playrooms.create({ template: 'twin', title: '合成等待', brief: '仅合成背景', persona: '合成角色', clientId: crypto.randomUUID() }, { kind: 'agent', name: '测试', binding: { type: 'local', localAgentId: 'codex' } });
  const thread = host.store.require('thread', room.threadId);
  host.store.appendRun(thread, { text: '等待', mode: 'codex', localAgentId: 'codex', contactId: thread.memberIds.find(id => id !== 'self'), sharedGroup: { id: room.id, actorId: 'self' } });
  thread.runs[0].status = 'unknown'; thread.runs[0].requiresReconciliation = true;
  host.store.put('thread', thread);
  const result = await (await fetch(`http://127.0.0.1:${host.address().port}/api/workspace/status`)).json();
  assert.equal(result.blockingRuns, 1); assert.equal(host.store.list('play_job').length, 0);
});
