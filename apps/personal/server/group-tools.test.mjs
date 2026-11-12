import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStore } from './store.mjs';
import { Messenger } from './messenger.mjs';
import { GroupSharing } from './group-sharing.mjs';
import { GroupTools } from './group-tools.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'group-tools-')), store = new PersonalStore(dir), messenger = new Messenger(store);
  t.after(async () => { await sharing.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  store.put('contact', { id: 'agent_codex', kind: 'agent', name: '搭子', handle: 'buddy', instructions: 'PRIVATE', discovered: true, added: true, binding: { type: 'local', localAgentId: 'codex' }, availability: 'ready', version: 1 });
  const thread = messenger.createChat({ kind: 'direct', memberIds: ['agent_codex'] });
  const run = store.appendRun(thread, { text: '帮我开旅行群并邀请朋友', mode: 'codex', contactId: 'agent_codex', localAgentId: 'codex', contactSnapshot: { name: '搭子' }, participantSnapshot: [{ id: 'self' }, { id: 'agent_codex' }] });
  thread.messages[0].contactId = 'self'; run.status = 'running'; store.put('thread', thread);
  const context = { threadId: thread.id, runId: run.id, messageId: run.messageId, contactId: 'agent_codex', mode: 'conversation' };
  const sharing = new GroupSharing(store, { messenger, validateInput: body => ({ ...body, attachments: [] }) }), tools = new GroupTools(sharing);
  return { store, messenger, thread, run, context, sharing, tools };
}
test('an owner-requested agent creates a normal group and a concrete invite card without a model bearer', async t => {
  const f = await fixture(t), catalog = f.tools.call(f.context, 'group_contacts', {}, 'list');
  assert.ok(catalog.contacts.some(c => c.id === 'agent_codex')); assert.ok(!JSON.stringify(catalog).includes('PRIVATE'));
  const args = { title: '海风计划', purpose: '共同准备一次周末旅行', agentIds: ['agent_codex'] };
  const result = f.tools.call(f.context, 'group_create', args, 'create');
  assert.equal(f.store.require('thread', result.threadId).kind, 'group');
  assert.equal(f.tools.call(f.context, 'group_create', args, 'create').threadId, result.threadId);
  const info = f.tools.call(f.context, 'group_info', { threadId: result.threadId }, 'info');
  const invitation = f.tools.call(f.context, 'group_invite', { threadId: result.threadId, version: info.version, brief: '公开的旅行需求', agents: [{ contactId: 'agent_codex', persona: '耐心的旅行搭子' }] }, 'invite');
  assert.equal(invitation.state, 'draft'); assert.ok(!JSON.stringify(invitation).includes('token')); assert.ok(!JSON.stringify(invitation).includes('#'));
  assert.ok(f.store.require('thread', f.thread.id).messages.some(m => m.groupCard?.threadId === result.threadId));
});
test('fresh roster/status invalidates a stale mutation, and public agents cannot inspect the private directory or expand groups', async t => {
  const f = await fixture(t), created = f.tools.call(f.context, 'group_create', { title: '一起做', purpose: '一个小项目', agentIds: ['agent_codex'] }, 'create');
  const before = f.tools.call(f.context, 'group_info', { threadId: created.threadId }, 'info');
  const group = f.store.require('thread', created.threadId); f.messenger.updateChat(group.id, { version: group.version, title: '新的名字' });
  const after = f.tools.call(f.context, 'group_info', { threadId: group.id }, 'info'); assert.notEqual(after.version, before.version);
  assert.throws(() => f.tools.call(f.context, 'group_add_agents', { threadId: group.id, version: before.version, agentIds: ['agent_codex'] }, 'stale'), e => e.code === 'group_changed');
  const runThread = f.store.require('thread', f.thread.id); runThread.runs[0].sharedGroup = { id: 'public' }; f.store.put('thread', runThread);
  assert.throws(() => f.tools.call(f.context, 'group_contacts', {}, 'no'), e => e.status === 403);
  assert.throws(() => f.tools.call(f.context, 'group_create', { title: '泄漏', purpose: 'x', agentIds: ['agent_codex'] }, 'no2'), e => e.status === 403);
});
test('standing rules are versioned and constrain expansion; auto publication applies only to a new group', async t => {
  const f = await fixture(t), rules = f.tools.rules();
  assert.throws(() => f.tools.saveRules({ ...rules, version: 99 }), e => e.status === 409);
  f.tools.saveRules({ ...rules, createGroups: false });
  assert.throws(() => f.tools.call(f.context, 'group_create', { title: '不能开', purpose: 'x', agentIds: ['agent_codex'] }, 'create'), e => e.code === 'rule_denied');
  f.tools.saveRules({ ...f.tools.rules(), createGroups: true, externalInvites: 'auto_new_group', maxGroupsPerRequest: 1 });
  const result = f.tools.call(f.context, 'group_create', { title: '开放共创', purpose: 'x', agentIds: ['agent_codex'] }, 'create2');
  const info = f.tools.call(f.context, 'group_info', { threadId: result.threadId }, 'info');
  assert.equal(f.tools.call(f.context, 'group_invite', { threadId: result.threadId, version: info.version, brief: '明确公开背景', agents: [{ contactId: 'agent_codex', persona: '公开角色' }] }, 'invite').state, 'published');
  assert.throws(() => f.tools.call(f.context, 'group_create', { title: '太多了', purpose: 'x', agentIds: ['agent_codex'] }, 'exceed'), e => e.code === 'group_budget');
});
test('the organizing agent can prepare an invitation for its own newly created group of other specialists', async t => {
  const f = await fixture(t); f.store.put('contact', { ...f.store.require('contact', 'agent_codex'), id: 'specialist', name: '路线专家', handle: 'specialist', discovered: false });
  const result = f.tools.call(f.context, 'group_create', { title: '交给专家', purpose: '旅行', agentIds: ['specialist'] }, 'create');
  const info = f.tools.call(f.context, 'group_info', { threadId: result.threadId }, 'info');
  assert.ok(info.roster.some(c => c.id === 'specialist'));
});
