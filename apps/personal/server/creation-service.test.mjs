import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStore } from './store.mjs';
import { Messenger } from './messenger.mjs';
import { CreationService } from './creation-service.mjs';
import { PersonalWorker } from './runtime.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'creation-service-')), store = new PersonalStore(directory), messenger = new Messenger(store);
  const profile = agentId => ({ agentId, defaults: { provider: 'synthetic', model: 'fixture-model', thinking: 'off' }, providers: ['synthetic'], models: [{ provider: 'synthetic', id: 'fixture-model', reasoning: false }], thinkingLevels: ['off'], version: 'fixture' });
  messenger.sync({ agents: ['codex', 'pi'].map(id => ({ id, name: id, installed: true, auth: { status: 'configured' }, execution: { supported: true }, profile: profile(id) })) });
  const service = new CreationService(store);
  t.after(async () => { await service.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const group = messenger.createChat({ kind: 'group', title: '合成共创群', memberIds: ['agent_codex', 'agent_pi'] });
  const send = (threadId = group.id) => {
    const thread = store.require('thread', threadId);
    messenger.appendMessage(thread, { text: '@all 做一个阅读作品', attachments: [] }, input => ({ ...input, attachments: [], memoryIds: [] }));
    return store.require('thread', threadId);
  };
  const thread = send();
  const context = (contactId, threadId = group.id) => {
    const thread = store.require('thread', threadId), run = thread.runs.findLast(item => item.contactId === contactId && !item.collaboration);
    store.updateThread(thread.id, item => { item.runs.find(r => r.id === run.id).status = 'running'; });
    return service.context(thread.id, run.id);
  };
  let callIndex = 0;
  const call = (ctx, name, args = {}) => service.call(ctx, name, args, `synthetic-call-${++callIndex}`);
  const prepare = (options = {}) => {
    const a = call(context('agent_codex'), 'creation_propose', { title: '阅读作品', kind: 'document', goal: '共同完成阅读产品设计', task: '实现结构与示例', writePaths: ['**'], dependsOnContacts: ['agent_pi'] });
    call(context('agent_pi'), 'creation_propose', { title: '阅读作品', kind: 'document', goal: '共同完成阅读产品设计', task: '给出设计说明', writePaths: options.piPaths || ['**'], dependsOnContacts: [] });
    store.updateThread(group.id, item => { for (const run of item.runs) run.status = 'completed'; });
    service.seal(group.id, thread.messages[0].id);
    return store.require('creation_proposal', a.proposalId);
  };
  const begin = workId => {
    service.runtime.enqueueNext(workId);
    const thread = store.require('thread', group.id), run = thread.runs.find(item => item.collaboration?.workId === workId && item.status === 'queued');
    if (!run) return null;
    store.updateThread(thread.id, item => { item.runs.find(r => r.id === run.id).status = 'running'; });
    service.runtime.prepare(thread.id, run.id);
    return service.context(thread.id, run.id);
  };
  const finish = ctx => service.runtime.finish(ctx.threadId, ctx.runId, { markdown: 'PRIVATE_WORK_REPLY_DO_NOT_BROADCAST', identity: { id: ctx.localAgentId } });
  const contribute = (ctx, path, text) => { call(ctx, 'artifact_write', { path, text, expectedHash: null }); call(ctx, 'artifact_submit', { summary: '合成贡献' }); call(ctx, 'task_complete', { summary: '已完成本步骤' }); finish(ctx); };
  return { directory, store, messenger, service, group, send, context, call, prepare, begin, finish, contribute };
}
const errorCode = wanted => error => error.code === wanted;

test('two native proposals join one ready intent and no content exists before approval', t => {
  const f = fixture(t), proposal = f.prepare();
  assert.equal(f.store.list('creation_proposal').length, 1);
  assert.equal(proposal.contributors.length, 2); assert.equal(proposal.state, 'ready');
  assert.ok(!existsSync(join(f.directory, 'artifacts')));
  assert.throws(() => f.call(f.context('agent_codex'), 'artifact_write', { path: 'bad.md', text: 'bad', expectedHash: null }), errorCode('tool_unavailable'));
});

test('approval is version-bound and replayed once; rejection has no creation side effects', t => {
  const f = fixture(t), proposal = f.prepare();
  assert.throws(() => f.service.decide(proposal.id, { choice: 'approve', version: proposal.version - 1, clientId: 'wrong-card-version' }), errorCode('version_conflict'));
  const input = { choice: 'approve', version: proposal.version, clientId: 'one-approved-plan' };
  const a = f.service.decide(proposal.id, input), b = f.service.decide(proposal.id, input);
  assert.equal(a.collaboration.id, b.collaboration.id); assert.equal(f.store.list('collaboration').length, 1);
  assert.equal(f.store.list('thread')[0].runs.filter(r => r.collaboration).length, 1);
  assert.ok(!existsSync(join(f.directory, 'artifacts')));
  const second = fixture(t), rejected = second.prepare();
  second.service.decide(rejected.id, { choice: 'reject', version: rejected.version, clientId: 'reject-current-plan' });
  assert.equal(second.store.list('collaboration').length, 0);
});

test('approved steps create genuinely attributed revisions without broadcasting private work output', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'approved-two-steps' });
  const pi = f.begin(collaboration.id); assert.equal(pi.contactId, 'agent_pi');
  f.contribute(pi, 'design.md', 'Pi designed the reading flow.');
  const codex = f.begin(collaboration.id); assert.equal(codex.contactId, 'agent_codex');
  f.contribute(codex, 'implementation.md', 'Codex implemented the reading flow.');
  const work = f.store.require('collaboration', collaboration.id);
  assert.equal(work.status, 'completed');
  const actual = f.store.list('artifact_contribution').filter(c => ['agent_pi', 'agent_codex'].includes(c.contactId));
  assert.deepEqual(actual.map(c => c.contactId).sort(), ['agent_codex', 'agent_pi']);
  assert.ok(!JSON.stringify(f.store.require('thread', f.group.id).messages).includes('PRIVATE_WORK_REPLY'));
  assert.equal(f.store.require('workspace_artifact', work.artifactId).headRevisionId, work.finalRevisionId);
});

test('pinned cross-group sharing cannot read a future head or bypass an ungranted recipient', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'approved-share-test' });
  const pi = f.begin(collaboration.id); f.contribute(pi, 'design.md', 'First design');
  const codex = f.begin(collaboration.id); f.contribute(codex, 'implementation.md', 'First implementation');
  const work = f.store.require('collaboration', collaboration.id), artifact = f.store.require('workspace_artifact', work.artifactId);
  const second = f.messenger.createChat({ kind: 'group', title: '另一个群', memberIds: ['agent_codex', 'agent_pi'] });
  f.service.share(artifact.id, { threadId: second.id, revisionId: artifact.headRevisionId, follow: false });
  f.send(second.id); const ctx = f.context('agent_codex', second.id);
  assert.equal(f.call(ctx, 'artifact_read', { artifactId: artifact.id, revisionId: artifact.headRevisionId }).files.length, 3);
  const owner = { owner: true, contactId: 'self', runId: 'human-edit' }, stage = f.service.artifacts.stage(artifact.id, 'future-head', artifact.headRevisionId, owner);
  f.service.artifacts.write(stage.id, { path: 'future.md', text: 'PRIVATE_FUTURE', expectedHash: null }, owner);
  const future = f.service.artifacts.integrate(f.service.artifacts.submit(stage.id, owner).id, owner);
  assert.throws(() => f.call(ctx, 'artifact_read', { artifactId: artifact.id, revisionId: future.revision.id }), errorCode('permission_required'));
  const human = f.messenger.saveContact({ kind: 'human', name: '新增成员', handle: 'new-human' });
  const current = f.store.require('thread', second.id);
  f.messenger.updateChat(second.id, { version: current.version, memberIds: [...current.memberIds, human.id] });
  f.send(second.id); const newContext = f.context('agent_codex', second.id);
  assert.equal(f.call(newContext, 'artifact_list').artifacts.length, 0);
});

test('removing a participant revokes late tools and quarantines its pending contribution', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'approved-revocation' });
  const ctx = f.begin(collaboration.id);
  f.call(ctx, 'artifact_write', { path: 'pending.md', text: 'Not integrated', expectedHash: null });
  f.call(ctx, 'artifact_check', {});
  const current = f.store.require('thread', f.group.id);
  f.messenger.updateChat(f.group.id, { version: current.version, memberIds: ['agent_codex'] });
  f.service.reconcileMembership(f.group.id);
  assert.throws(() => f.call(ctx, 'artifact_submit', { summary: 'late' }), errorCode('grant_revoked'));
  assert.equal(f.store.list('artifact_contribution').find(c => c.contactId === 'agent_pi').state, 'quarantined');
});

test('delegation queues immediately and a yielded parent resumes after its child without taking two slots', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'approved-delegation' });
  const parent = f.begin(collaboration.id);
  const child = f.call(parent, 'task_delegate', { contactId: 'agent_codex', task: 'Prepare shared input', writePaths: ['**'], dependsOnStepIds: [] });
  f.call(parent, 'task_yield', { waitForStepIds: [child.stepId], checkpoint: 'Waiting for shared input, no uncommitted changes.' }); f.finish(parent);
  const childContext = f.begin(collaboration.id); assert.equal(childContext.stepId, child.stepId);
  f.contribute(childContext, 'shared.md', 'Shared input');
  const resumed = f.begin(collaboration.id); assert.equal(resumed.stepId, parent.stepId); assert.notEqual(resumed.runId, parent.runId);
  assert.equal(f.call(resumed, 'artifact_read', { paths: ['shared.md'] }).files[0].text, 'Shared input');
  f.contribute(resumed, 'parent.md', 'Parent finished');
});

test('the broker acknowledges a durable yield while rejecting subsequent work calls from that attempt', async t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'approved-yield-transport' });
  const parent = f.begin(collaboration.id), child = f.call(parent, 'task_delegate', { contactId: 'agent_codex', task: 'Prepare input', writePaths: ['**'] });
  const session = await f.service.runtime.session(parent.threadId, parent.runId);
  const call = body => fetch(session.endpoint, { method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await call({ name: 'task_yield', arguments: { waitForStepIds: [child.stepId], checkpoint: 'Wait for input' }, callId: 'durable-yield' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.state, 'waiting_dependency');
  assert.equal((await call({ name: 'task_claim', arguments: {}, callId: 'late-call' })).status, 403);
});

test('an extra file scope stays blocked until a version-bound owner permission decision', t => {
  const f = fixture(t), proposal = f.prepare({ piPaths: ['design.md'] }), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'narrow-write-plan' });
  const ctx = f.begin(collaboration.id), write = { path: 'extra.md', text: 'extra design', expectedHash: null };
  assert.throws(() => f.call(ctx, 'artifact_write', write), errorCode('permission_required'));
  const requested = f.call(ctx, 'permission_request', { capability: 'artifact_write', reason: '需要补充一份设计说明', paths: ['extra.md'] });
  assert.throws(() => f.call(ctx, 'artifact_write', write), errorCode('permission_required'));
  f.service.decidePermission(requested.requestId, { version: 1, choice: 'approve', clientId: 'approve-extra-file' });
  assert.equal(f.call(ctx, 'artifact_write', write).path, 'extra.md');
});

test('cached file results are denied when a shared path is revoked', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'cache-scope-plan' });
  const pi = f.begin(collaboration.id); f.contribute(pi, 'design.md', 'Design');
  const codex = f.begin(collaboration.id); f.contribute(codex, 'implementation.md', 'Implementation');
  f.send(); const ctx = f.context('agent_codex'), work = f.store.require('collaboration', collaboration.id), artifact = f.store.require('workspace_artifact', work.artifactId);
  const args = { artifactId: artifact.id, revisionId: artifact.headRevisionId, paths: ['design.md'] };
  f.service.call(ctx, 'artifact_read', args, 'cached-private-read');
  const link = f.store.list('artifact_link').find(item => item.threadId === f.group.id);
  f.store.put('artifact_link', { ...link, paths: ['implementation.md'] });
  assert.throws(() => f.service.call(ctx, 'artifact_read', args, 'cached-private-read'), errorCode('permission_required'));
  assert.equal(f.service.canPublishConversation(ctx.threadId, ctx.runId), false);
});

test('the existing single worker uses native conversation tools and then executes approved steps', async t => {
  const f = fixture(t); let sequence = 0, active = 0, maximum = 0;
  const execute = async input => {
    maximum = Math.max(maximum, ++active);
    try {
      assert.ok(input.toolSession, 'native tools must reach the actual executor adapter');
      const call = async (name, args = {}) => {
        const response = await fetch(input.toolSession.endpoint, { method: 'POST', headers: { authorization: `Bearer ${input.toolSession.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, arguments: args, callId: `worker-${++sequence}` }) });
        const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result.result;
      };
      if (input.toolSession.toolNames.includes('creation_propose')) {
        assert.match(input.prompt, /creation_propose/);
        await call('creation_propose', { title: '真实流程合成测试', kind: 'document', goal: '验证聊天到作品', task: `${input.id} 的贡献`, writePaths: [`${input.id}.md`] });
        return { markdown: JSON.stringify({ action: 'reply', text: `${input.id} 提出自己的思路` }), identity: { id: input.id } };
      }
      await call('artifact_read');
      await call('artifact_write', { path: `${input.id}.md`, text: `${input.id} 的实际文件`, expectedHash: null });
      await call('artifact_submit', { summary: '已提交自己的文件' }); await call('task_complete', { summary: '已完成' });
      return { markdown: 'PRIVATE_WORK_TEXT', identity: { id: input.id } };
    } finally { active--; }
  };
  f.service.options.executeLocalAgent = execute;
  const worker = new PersonalWorker(f.store, { creationService: f.service, executeLocalAgent: execute }, () => {});
  t.after(() => worker.close());
  await worker.drain();
  const proposal = f.store.list('creation_proposal')[0];
  assert.equal(proposal?.state, 'ready'); assert.equal(proposal.contributors.length, 2);
  f.service.decide(proposal.id, { version: proposal.version, choice: 'approve', clientId: 'worker-flow-approve' });
  await worker.drain();
  assert.equal(f.store.list('collaboration')[0].status, 'completed'); assert.equal(maximum, 1);
  assert.equal(f.store.require('thread', f.group.id).messages.filter(m => m.role === 'assistant').length, 2);
  assert.ok(!JSON.stringify(f.store.require('thread', f.group.id).messages).includes('PRIVATE_WORK_TEXT'));
});

test('internal collaboration scheduling preserves an unrelated pending approval', t => {
  const f = fixture(t), proposal = f.prepare();
  f.store.updateThread(f.group.id, thread => { const run = thread.runs.find(r => r.contactId === 'agent_pi'); run.status = 'needs_input'; thread.decisions.push({ id: 'unrelated-preview', runId: run.id, state: 'pending', version: 1 }); });
  f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'preserve-other-preview' });
  const thread = f.store.require('thread', f.group.id);
  assert.equal(thread.decisions[0].state, 'pending'); assert.equal(thread.runs[1].status, 'needs_input');
});

test('a crash after yield marks the unfinished executor attempt unknown', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'yield-crash-plan' });
  const ctx = f.begin(collaboration.id), child = f.call(ctx, 'task_delegate', { contactId: 'agent_codex', task: 'Child' });
  f.call(ctx, 'task_yield', { waitForStepIds: [child.stepId], checkpoint: 'Waiting' });
  f.store.recover(); f.service.runtime.recover();
  assert.equal(f.store.require('collaboration', collaboration.id).status, 'unknown');
  assert.equal(f.service.runtime.enqueueNext(collaboration.id), null);
});

test('owner stop revokes a native session and retry cannot replay an unknown attempt', async t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'control-stop-plan' });
  const ctx = f.begin(collaboration.id), session = await f.service.runtime.session(ctx.threadId, ctx.runId);
  f.service.runtime.control(collaboration.id, { action: 'stop', clientId: 'stop-this-work' });
  assert.throws(() => f.call(ctx, 'artifact_write', { path: 'late.md', text: 'late', expectedHash: null }), errorCode('grant_revoked'));
  const response = await fetch(session.endpoint, { headers: { authorization: `Bearer ${session.token}` } }); assert.equal(response.status, 401);
  const work = f.store.require('collaboration', collaboration.id); work.status = 'unknown'; work.steps[0].status = 'unknown'; f.store.put('collaboration', work);
  assert.throws(() => f.service.runtime.control(work.id, { action: 'retry', stepId: work.steps[0].id, clientId: 'unsafe-unknown-retry' }), errorCode('reconciliation_required'));
});

test('the owner can revise the shared goal and scopes, invalidating the older review card', t => {
  const f = fixture(t), proposal = f.prepare();
  const updated = f.service.ownerUpdate(proposal.id, { version: proposal.version, goal: '先做文档，不做网页', tasks: { agent_pi: '只做一个阅读场景' }, paths: { agent_pi: ['design.md'] }, dependencies: { agent_codex: [] }, clientId: 'owner-adjust-plan' });
  assert.equal(updated.goal, '先做文档，不做网页'); assert.equal(updated.contributors.find(item => item.contactId === 'agent_pi').writePaths[0], 'design.md');
  assert.ok(updated.version > proposal.version);
  assert.throws(() => f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'old-plan-after-owner-edit' }), errorCode('version_conflict'));
});

test('permission approval resumes a paused step with its unsubmitted files intact', t => {
  const f = fixture(t), proposal = f.prepare({ piPaths: ['design.md'] }), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'pause-for-permission' });
  const ctx = f.begin(collaboration.id);
  f.call(ctx, 'artifact_write', { path: 'design.md', text: 'Keep this draft', expectedHash: null });
  const request = f.call(ctx, 'permission_request', { capability: 'artifact_write', paths: ['extra.md'], reason: 'Need another design note' });
  f.finish(ctx);
  assert.equal(f.store.require('collaboration', collaboration.id).steps.find(step => step.id === ctx.stepId).status, 'waiting_permission');
  f.service.decidePermission(request.requestId, { choice: 'approve', version: 1, clientId: 'allow-extra-note' });
  const resumed = f.begin(collaboration.id); assert.notEqual(resumed.runId, ctx.runId);
  assert.equal(f.call(resumed, 'artifact_read', { paths: ['design.md'] }).files[0].text, 'Keep this draft');
  f.contribute(resumed, 'extra.md', 'Additional design note');
  assert.equal(f.store.require('collaboration', collaboration.id).steps.find(step => step.id === ctx.stepId).status, 'completed');
});

test('denying extra scope resumes within the original grant and rejoining does not regain old shares', t => {
  const f = fixture(t), proposal = f.prepare({ piPaths: ['design.md'] }), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'deny-and-rejoin' });
  const ctx = f.begin(collaboration.id), request = f.call(ctx, 'permission_request', { capability: 'artifact_write', paths: ['extra.md'], reason: 'Additional design note' }); f.finish(ctx);
  f.service.decidePermission(request.requestId, { choice: 'reject', version: 1, clientId: 'deny-extra-scope' });
  const resumed = f.begin(collaboration.id); assert.ok(resumed);
  assert.throws(() => f.call(resumed, 'artifact_write', { path: 'extra.md', text: 'Denied', expectedHash: null }), errorCode('permission_required'));
  f.contribute(resumed, 'design.md', 'Within original scope'); f.contribute(f.begin(collaboration.id), 'implementation.md', 'Implementation');
  let thread = f.store.require('thread', f.group.id); f.messenger.updateChat(thread.id, { version: thread.version, memberIds: ['agent_codex'] }); f.service.reconcileMembership(thread.id);
  thread = f.store.require('thread', f.group.id); f.messenger.updateChat(thread.id, { version: thread.version, memberIds: ['agent_codex', 'agent_pi'] }); f.service.reconcileMembership(thread.id);
  f.send(); assert.equal(f.call(f.context('agent_codex'), 'artifact_list').artifacts.length, 0);
});

test('an agent joins an existing website plan without reclassifying its Markdown contribution', t => {
  const f = fixture(t), first = f.call(f.context('agent_codex'), 'creation_propose', { title: 'Website', kind: 'website', goal: 'A website with design notes', task: 'Build index.html', writePaths: ['index.html'] });
  const joined = f.call(f.context('agent_pi'), 'creation_update', { proposalId: first.proposalId, version: first.version, task: 'Write decisions.md for the same website', writePaths: ['decisions.md'] });
  assert.equal(joined.contributors.length, 2); assert.equal(f.store.require('creation_proposal', first.proposalId).kind, 'website');
});
