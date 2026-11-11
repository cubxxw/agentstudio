import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStore } from './store.mjs';
import { Messenger } from './messenger.mjs';
import { CreationService } from './creation-service.mjs';
import { ArtifactAPI } from './artifact-api.mjs';
import { PersonalWorker, threadContext } from './runtime.mjs';

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
  const begin = (workId, threadId = group.id) => {
    service.runtime.enqueueNext(workId);
    const thread = store.require('thread', threadId), run = thread.runs.find(item => item.collaboration?.workId === workId && item.status === 'queued');
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

test('rejecting a plan with invalid dependencies clears its workspace-switch blocker without starting work', t => {
  const f = fixture(t), proposal = f.prepare(), api = new ArtifactAPI(f.service, () => {});
  const invalid = f.service.ownerUpdate(proposal.id, { version: proposal.version, goal: proposal.goal, dependencies: { agent_pi: ['agent_codex'] }, clientId: 'introduce-cycle' });
  assert.equal(invalid.state, 'needs_input');
  assert.equal(api.blockers(), 1);
  assert.throws(() => f.service.decide(invalid.id, { choice: 'approve', version: invalid.version, clientId: 'cannot-approve-cycle' }), errorCode('inactive_proposal'));
  const result = f.service.decide(invalid.id, { choice: 'reject', version: invalid.version, clientId: 'reject-cycle' });
  assert.equal(result.proposal.state, 'rejected');
  assert.equal(result.collaboration, null);
  assert.equal(f.store.list('collaboration').length, 0);
  assert.equal(f.store.require('thread', f.group.id).runs.filter(run => run.collaboration).length, 0);
  assert.equal(api.blockers(), 0);
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

test('concurrent conversation reads use native tools while approved creation steps remain exclusive', async t => {
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
  assert.equal(maximum, 2, 'independent chat members overlap'); maximum = 0;
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

function completedFixtureArtifact(f) {
  const proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: `seed-${proposal.id}` });
  f.contribute(f.begin(collaboration.id), 'design.md', 'PRIVATE_SOURCE_VALUE');
  f.contribute(f.begin(collaboration.id), 'implementation.md', 'Implementation');
  return f.store.require('workspace_artifact', f.store.require('collaboration', collaboration.id).artifactId);
}
function proposedWork(f, threadId, artifactId = null, kind = 'document') {
  if (!f.store.require('thread', threadId).messages.length) f.send(threadId);
  const ctx = f.context('agent_codex', threadId), first = f.call(ctx, 'creation_propose', { title: 'Shared work', kind, goal: 'Do the approved work', task: 'Codex contribution', writePaths: ['**'], ...(artifactId ? { artifactId } : {}) });
  f.call(f.context('agent_pi', threadId), 'creation_update', { proposalId: first.proposalId, version: first.version, task: 'Pi contribution', writePaths: ['**'] });
  f.store.updateThread(threadId, thread => { for (const run of thread.runs.filter(run => run.messageId === ctx.messageId && !run.collaboration)) run.status = 'completed'; });
  const proposal = f.service.seal(threadId, ctx.messageId);
  return f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: `approve-${proposal.id}` }).collaboration;
}

test('an intervening private head is never promoted to a pinned group before a queued step starts', t => {
  const f = fixture(t), artifact = completedFixtureArtifact(f), second = f.messenger.createChat({ kind: 'group', title: 'Pinned group', memberIds: ['agent_codex', 'agent_pi'] });
  f.service.share(artifact.id, { threadId: second.id, revisionId: artifact.headRevisionId });
  const work = proposedWork(f, second.id, artifact.id), owner = { owner: true, contactId: 'self', runId: 'private-head-edit' }, stage = f.service.artifacts.stage(artifact.id, 'private-intervening', artifact.headRevisionId, owner);
  f.service.artifacts.write(stage.id, { path: 'private-future.md', text: 'PRIVATE_FUTURE', expectedHash: null }, owner);
  f.service.artifacts.integrate(f.service.artifacts.submit(stage.id, owner).id, owner);
  assert.throws(() => f.begin(work.id, second.id));
  assert.equal(f.store.list('artifact_link').find(link => link.threadId === second.id).revisionId, artifact.headRevisionId);
});

test('remaining contributors cannot restore a removed member in a later link update', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'permanent-audience-reduction' });
  f.contribute(f.begin(collaboration.id), 'design.md', 'Design');
  let thread = f.store.require('thread', f.group.id); f.messenger.updateChat(thread.id, { version: thread.version, memberIds: ['agent_codex'] }); f.service.reconcileMembership(thread.id);
  f.contribute(f.begin(collaboration.id), 'implementation.md', 'Implementation');
  thread = f.store.require('thread', f.group.id); f.messenger.updateChat(thread.id, { version: thread.version, memberIds: ['agent_codex', 'agent_pi'] }); f.service.reconcileMembership(thread.id);
  f.send(); assert.equal(f.call(f.context('agent_codex'), 'artifact_list').artifacts.length, 0);
});

test('withdrawal revokes an active work and cached artifact metadata immediately', t => {
  const f = fixture(t), artifact = completedFixtureArtifact(f), second = f.messenger.createChat({ kind: 'group', title: 'Withdraw work', memberIds: ['agent_codex', 'agent_pi'] });
  const link = f.service.share(artifact.id, { threadId: second.id, revisionId: artifact.headRevisionId });
  const work = proposedWork(f, second.id, artifact.id), ctx = f.begin(work.id, second.id);
  f.service.call(ctx, 'artifact_list', {}, 'metadata-receipt-before-revoke');
  f.service.share(artifact.id, { threadId: second.id, revoke: true, expectedVersion: link.version });
  assert.throws(() => f.service.call(ctx, 'artifact_list', {}, 'metadata-receipt-before-revoke'), error => ['grant_revoked', 'permission_required'].includes(error.code));
  assert.throws(() => f.call(ctx, 'artifact_write', { path: 'late.md', text: 'Late', expectedHash: null }), errorCode('grant_revoked'));
});

test('follow sharing begins at its committed starting revision and excludes old revisions and candidates', t => {
  const f = fixture(t), artifact = completedFixtureArtifact(f), old = f.store.list('artifact_revision').find(rev => rev.artifactId === artifact.id && rev.state === 'committed' && rev.id !== artifact.headRevisionId), second = f.messenger.createChat({ kind: 'group', title: 'Follow forward', memberIds: ['agent_codex', 'agent_pi'] });
  f.service.share(artifact.id, { threadId: second.id, revisionId: artifact.headRevisionId, follow: true }); f.send(second.id); const ctx = f.context('agent_codex', second.id);
  assert.throws(() => f.call(ctx, 'artifact_read', { artifactId: artifact.id, revisionId: old.id }), errorCode('permission_required'));
  const owner = { owner: true, contactId: 'self', runId: 'private-candidate' }, stage = f.service.artifacts.stage(artifact.id, 'private-candidate', artifact.headRevisionId, owner);
  f.service.artifacts.write(stage.id, { path: 'private.md', text: 'NOT_COMMITTED', expectedHash: null }, owner);
  const candidate = f.service.artifacts.candidate(f.service.artifacts.submit(stage.id, owner).id, owner);
  assert.throws(() => f.call(ctx, 'artifact_read', { artifactId: artifact.id, revisionId: candidate.id }), errorCode('permission_required'));
});

test('private work sources and free-form work notes never become group-readable cards or links', t => {
  const f = fixture(t), source = completedFixtureArtifact(f), watcher = f.messenger.saveContact({ kind: 'agent', name: 'Observer', handle: 'observer', binding: { type: 'local', localAgentId: 'codex' } });
  const second = f.messenger.createChat({ kind: 'group', title: 'Wider group', memberIds: ['agent_codex', 'agent_pi', watcher.id] }), work = proposedWork(f, second.id), ctx = f.begin(work.id, second.id);
  const request = f.call(ctx, 'permission_request', { capability: 'artifact_read', artifactId: source.id, revisionId: source.headRevisionId, paths: ['design.md'], reason: 'PRIVATE_WORK_REASON' });
  f.service.decidePermission(request.requestId, { version: 1, choice: 'approve', clientId: 'grant-private-work-source' });
  assert.equal(f.call(ctx, 'artifact_read', { artifactId: source.id, revisionId: source.headRevisionId, paths: ['design.md'] }).files[0].text, 'PRIVATE_SOURCE_VALUE');
  f.call(ctx, 'collaboration_message', { contactId: 'agent_pi', text: 'PRIVATE_WORK_HANDOFF' });
  f.call(ctx, 'task_delegate', { contactId: 'agent_pi', task: 'PRIVATE_DELEGATED_TASK', writePaths: ['**'] });
  const publicView = JSON.stringify(f.service.forThread(second.id)); assert.ok(!/PRIVATE_WORK_REASON|PRIVATE_WORK_HANDOFF|PRIVATE_DELEGATED_TASK/.test(publicView));
  f.send(second.id); const observer = f.context(watcher.id, second.id);
  assert.throws(() => f.call(observer, 'artifact_read', { artifactId: source.id, revisionId: source.headRevisionId, paths: ['design.md'] }), errorCode('permission_required'));
});

test('revoked read data cannot be written into a new public proposal after final-read publication protection', t => {
  const f = fixture(t), artifact = completedFixtureArtifact(f); f.send(); const ctx = f.context('agent_codex');
  f.call(ctx, 'artifact_read', { artifactId: artifact.id, revisionId: artifact.headRevisionId, paths: ['design.md'] });
  const link = f.store.list('artifact_link').find(link => link.threadId === f.group.id && link.artifactId === artifact.id);
  f.service.share(artifact.id, { threadId: f.group.id, revoke: true, expectedVersion: link.version });
  assert.throws(() => f.call(ctx, 'creation_propose', { title: 'Private title', kind: 'document', goal: 'PRIVATE_SOURCE_VALUE', task: 'Publish read bytes', writePaths: ['**'] }), errorCode('permission_required'));
});

test('artifact dependencies carried by a reaction propagate before another member can publish', t => {
  const f = fixture(t), artifact = completedFixtureArtifact(f); f.send();
  const first = f.context('agent_codex');
  f.call(first, 'artifact_read', { artifactId: artifact.id, revisionId: artifact.headRevisionId, paths: ['design.md'] });
  const source = f.store.require('thread', f.group.id), firstRun = source.runs.find(run => run.id === first.runId);
  f.store.updateThread(f.group.id, thread => {
    thread.messages.find(message => message.id === firstRun.messageId).reactions = [{ contactId: 'agent_codex', emoji: '✅', artifactReads: firstRun.artifactReads, recipientIds: [...thread.memberIds] }];
  });
  const second = f.context('agent_pi'), current = f.store.require('thread', f.group.id), secondRun = current.runs.find(run => run.id === second.runId);
  assert.equal(secondRun.artifactReads?.length || 0, 0);
  const supplied = threadContext(f.store, current, secondRun, f.service);
  assert.equal(supplied.messages.at(-1).reactions[0].emoji, '✅');
  assert.deepEqual(f.store.require('thread', f.group.id).runs.find(run => run.id === second.runId).artifactReads, firstRun.artifactReads);
  const link = f.store.list('artifact_link').find(link => link.threadId === f.group.id && link.artifactId === artifact.id);
  f.service.share(artifact.id, { threadId: f.group.id, revoke: true, expectedVersion: link.version });
  assert.equal(f.service.canPublishConversation(f.group.id, second.runId), false);
});

test('queued approved DAGs recover after the decision commits before initial dispatch', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'recover-undispatched-plan' });
  f.store.updateThread(f.group.id, thread => { thread.runs = thread.runs.filter(run => !run.collaboration); });
  const work = f.store.require('collaboration', collaboration.id); for (const step of work.steps) { delete step.activeRunId; step.runIds = []; } f.store.put('collaboration', work);
  f.service.runtime.recover();
  assert.equal(f.store.require('thread', f.group.id).runs.filter(run => run.collaboration && run.status === 'queued').length, 1);
});

test('unknown work has an explicit reviewed abandon path without replay or fake completion', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'reconcile-unknown-work' });
  const ctx = f.begin(collaboration.id); f.store.recover(); f.service.runtime.recover();
  assert.throws(() => f.service.runtime.control(collaboration.id, { action: 'reconcile', stepId: ctx.stepId, runId: ctx.runId, choice: 'abandon', clientId: 'no-process-confirmation' }), errorCode('process_stop_confirmation_required'));
  f.service.runtime.control(collaboration.id, { action: 'reconcile', stepId: ctx.stepId, runId: ctx.runId, choice: 'abandon', confirmedStopped: true, clientId: 'owner-reviewed-abandon' });
  assert.equal(f.store.require('collaboration', collaboration.id).status, 'cancelled');
  const run = f.store.require('thread', f.group.id).runs.find(run => run.id === ctx.runId); assert.equal(run.status, 'cancelled'); assert.ok(!run.requiresReconciliation && !run.stopUnconfirmed);
});

test('an approved work receives exact fingerprinted inputs and later groups cannot inherit raw original attachments', t => {
  const f = fixture(t); f.store.updateThread(f.group.id, thread => { thread.messages[0].attachments = [{ id: 'source_exact_table', name: 'numbers.csv', text: 'SKU,Count\nalpha,271828' }]; });
  const proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'exact-source-inputs' });
  const inputs = f.service.workInput(f.store.require('collaboration', collaboration.id)); assert.equal(inputs.sources[0].text, 'SKU,Count\nalpha,271828');
  f.store.updateThread(f.group.id, thread => { thread.messages[0].attachments[0].text = 'changed'; });
  assert.throws(() => f.service.workInput(f.store.require('collaboration', collaboration.id)), errorCode('input_changed'));
});

test('read receipts reference immutable snapshots rather than duplicating file text in every operation', t => {
  const f = fixture(t), proposal = f.prepare(), { collaboration } = f.service.decide(proposal.id, { choice: 'approve', version: proposal.version, clientId: 'bounded-read-receipts' }), ctx = f.begin(collaboration.id);
  const text = 'PRIVATE_STAGED_READ_'.repeat(10000); f.call(ctx, 'artifact_write', { path: 'large.md', text, expectedHash: null });
  const original = f.service.call(ctx, 'artifact_read', { paths: ['large.md'] }, 'stable-read-snapshot');
  const receipt = f.store.list('artifact_tool_operation').find(item => item.name === 'artifact_read'); assert.ok(!JSON.stringify(receipt).includes('PRIVATE_STAGED_READ_'));
  f.call(ctx, 'artifact_write', { path: 'large.md', text: 'Updated', expectedHash: original.files[0].sha256 });
  assert.equal(f.service.call(ctx, 'artifact_read', { paths: ['large.md'] }, 'stable-read-snapshot').files[0].text, text);
});

test('collaboration dispatch shares the global unconfirmed-executor guard across groups', async t => {
  const f = fixture(t), work = proposedWork(f, f.group.id), ctx = f.begin(work.id);
  f.store.put('thread', { id: 'other_group', kind: 'group', memberIds: ['self', ctx.contactId], messages: [], runs: [{ id: 'old_unconfirmed', mode: 'codex', status: 'unknown', localAgentId: ctx.localAgentId, stopUnconfirmed: true }], events: [] });
  let executions = 0; f.service.options.executeLocalAgent = async () => { executions++; return { markdown: 'Unexpected launch', identity: { id: ctx.localAgentId } }; };
  await f.service.runtime.execute(f.store.require('thread', ctx.threadId), f.store.require('thread', ctx.threadId).runs.find(run => run.id === ctx.runId), new AbortController().signal);
  assert.equal(executions, 0); assert.equal(f.store.require('collaboration', work.id).status, 'blocked');
});

test('a confirmed normal stop remains cancelled after the executor rejection is reaped', async t => {
  const f = fixture(t), work = proposedWork(f, f.group.id), ctx = f.begin(work.id), controller = new AbortController(); let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  f.service.options.cancelRun = () => controller.abort();
  f.service.options.executeLocalAgent = async input => { entered(); return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped'), { code: 'cancelled' })), { once: true })); };
  const execution = f.service.runtime.execute(f.store.require('thread', ctx.threadId), f.store.require('thread', ctx.threadId).runs.find(run => run.id === ctx.runId), controller.signal);
  await ready; f.service.runtime.control(work.id, { action: 'stop', clientId: 'confirmed-normal-stop' }); await execution;
  assert.equal(f.store.require('collaboration', work.id).status, 'cancelled');
});

test('website work keeps the old Finder and shared version until native checks accept the final output', t => {
  const f = fixture(t), work = proposedWork(f, f.group.id, null, 'website'), codex = f.begin(work.id);
  f.contribute(codex, 'index.html', '<!doctype html><h1>First page</h1>'); f.contribute(f.begin(work.id), 'decisions.md', 'Design');
  let saved = f.store.require('collaboration', work.id); assert.equal(saved.status, 'waiting_preview');
  assert.equal(f.store.list('artifact_link').length, 0); assert.equal(f.store.require('workspace_artifact', saved.artifactId).currentRevisionId, null);
  f.service.runtime.recordPreviewCheck(work.id, saved.finalRevisionId, { passed: true, errors: [], viewports: [] });
  const first = f.store.require('workspace_artifact', saved.artifactId), firstLink = f.store.list('artifact_link')[0];
  f.send(); const next = proposedWork(f, f.group.id, first.id, 'website'), nextCodex = f.begin(next.id), current = f.call(nextCodex, 'artifact_read', { paths: ['index.html'] }).files[0];
  f.call(nextCodex, 'artifact_write', { path: 'index.html', text: '<!doctype html><h1>Broken page</h1><script>throw Error("broken")</script>', expectedHash: current.sha256 });
  f.call(nextCodex, 'artifact_submit', { summary: 'Working revision' }); f.call(nextCodex, 'task_complete', { summary: 'Saved' }); f.finish(nextCodex);
  const pi = f.begin(next.id), old = f.call(pi, 'artifact_read', { paths: ['decisions.md'] }).files[0]; f.call(pi, 'artifact_write', { path: 'decisions.md', text: 'Changed design', expectedHash: old.sha256 }); f.call(pi, 'artifact_submit', { summary: 'Changed design' }); f.call(pi, 'task_complete', { summary: 'Saved' }); f.finish(pi);
  saved = f.store.require('collaboration', next.id); f.service.runtime.recordPreviewCheck(next.id, saved.finalRevisionId, { passed: false, errors: ['broken'], viewports: [] });
  assert.equal(f.store.require('workspace_artifact', first.id).currentRevisionId, first.currentRevisionId);
  assert.equal(f.store.list('artifact_link').find(link => link.id === firstLink.id).revisionId, firstLink.revisionId);
});

test('revoked history is excluded from a new prompt even when the current run never calls artifact_read', async t => {
  const f = fixture(t), artifact = completedFixtureArtifact(f); let phase = 'read'; const contexts = [];
  const execute = async input => {
    const context = JSON.parse(input.prompt.split('<untrusted_thread_context>\n')[1].split('\n</untrusted_thread_context>')[0]);
    if (phase === 'observe') contexts.push(context);
    if (phase === 'read' && input.id === 'codex') {
      const response = await fetch(input.toolSession.endpoint, { method: 'POST', headers: { authorization: `Bearer ${input.toolSession.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'artifact_read', arguments: { artifactId: artifact.id, revisionId: artifact.headRevisionId, paths: ['design.md'] }, callId: 'history-source-read' }) }); assert.equal(response.status, 200); await response.json();
    }
    return { markdown: JSON.stringify({ action: 'reply', text: phase === 'read' && input.id === 'codex' ? 'PRIVATE_SOURCE_VALUE' : 'Ordinary reply' }), identity: { id: input.id } };
  };
  const worker = new PersonalWorker(f.store, { creationService: f.service, executeLocalAgent: execute }, () => {}); t.after(() => worker.close());
  f.send(); await worker.drain(); const link = f.store.list('artifact_link').find(link => link.threadId === f.group.id && link.artifactId === artifact.id);
  f.service.share(artifact.id, { threadId: f.group.id, revoke: true, expectedVersion: link.version }); phase = 'observe'; f.send(); await worker.drain();
  assert.equal(contexts.length, 2); assert.ok(!JSON.stringify(contexts).includes('PRIVATE_SOURCE_VALUE'));
});

test('owner local-file coordination resumes a finished work without launching another model', async t => {
  const f = fixture(t), work = proposedWork(f, f.group.id), first = f.begin(work.id);
  const artifactId = f.store.require('collaboration', work.id).artifactId;
  const { writeFileSync, readFileSync } = await import('node:fs'); writeFileSync(join(f.directory, 'artifacts', artifactId, 'current', '.DS_Store'), Buffer.from([0, 0xff, 0x81]));
  f.contribute(first, 'implementation.md', 'Implementation'); f.contribute(f.begin(work.id), 'design.md', 'Design');
  assert.equal(f.store.require('collaboration', work.id).status, 'waiting_local_changes');
  const runCount = f.store.require('thread', f.group.id).runs.length;
  f.service.artifacts.resolveLocal(artifactId, 'preserve-and-update', { owner: true }); f.service.runtime.resumeAfterLocal(artifactId);
  assert.equal(f.store.require('collaboration', work.id).status, 'completed'); assert.equal(f.store.require('thread', f.group.id).runs.length, runCount);
  const { readdirSync } = await import('node:fs'); const backup = readdirSync(join(f.directory, 'artifacts', artifactId, 'local-backups')).find(name => existsSync(join(f.directory, 'artifacts', artifactId, 'local-backups', name, '.DS_Store'))); assert.ok(backup, 'the complete human tree is retained regardless of filesystem directory order'); assert.equal(readFileSync(join(f.directory, 'artifacts', artifactId, 'local-backups', backup, '.DS_Store'))[1], 255);
});

test('a later owner share choice supersedes automatic output publication', t => {
  const f = fixture(t), artifact = completedFixtureArtifact(f); f.send(); const work = proposedWork(f, f.group.id, artifact.id), first = f.begin(work.id);
  f.service.share(artifact.id, { threadId: f.group.id, revisionId: artifact.headRevisionId, paths: ['design.md'], follow: false });
  f.contribute(first, 'new-implementation.md', 'New'); f.contribute(f.begin(work.id), 'new-design.md', 'New');
  const link = f.store.list('artifact_link').find(link => link.threadId === f.group.id && link.artifactId === artifact.id);
  assert.equal(link.revisionId, artifact.headRevisionId); assert.deepEqual(link.paths, ['design.md']);
});

test('a second group receives its own exact inputs and no original source attachments', t => {
  const f = fixture(t); f.store.updateThread(f.group.id, thread => { thread.messages[0].attachments = [{ id: 'original-secret', name: 'private-source.txt', text: 'ORIGINAL_PRIVATE_SOURCE' }]; });
  const artifact = completedFixtureArtifact(f), second = f.messenger.createChat({ kind: 'group', title: 'Continue', memberIds: ['agent_codex', 'agent_pi'] });
  f.service.share(artifact.id, { threadId: second.id, revisionId: artifact.headRevisionId });
  const next = proposedWork(f, second.id, artifact.id), inputs = f.service.workInput(next);
  assert.deepEqual(inputs.sources, []); assert.ok(!JSON.stringify(inputs).includes('ORIGINAL_PRIVATE_SOURCE')); assert.equal(inputs.request, '@all 做一个阅读作品');
});
