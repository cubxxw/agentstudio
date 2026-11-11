import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PersonalStore } from './store.mjs';
import { Messenger } from './messenger.mjs';
import { AgentScheduler, nextDailyRun, parseGoalDecision } from './agent-scheduler.mjs';

const profile = { agentId: 'codex', defaults: { provider: 'openai', model: 'fixture-model', thinking: 'low' }, providers: ['openai'], models: [], thinkingLevels: ['low'], version: 'fixture-v1' };
const detected = { agents: [{ id: 'codex', name: 'Codex', installed: true, auth: { status: 'configured' }, execution: { supported: true }, profile }] };
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agentstudio-scheduler-'));
  let store = new PersonalStore(dir), clock = new Date('2026-11-11T01:00:00.000Z');
  const construct = () => { const messenger = new Messenger(store); messenger.sync(detected); return new AgentScheduler(store, messenger, { clock: () => clock, validateInput: body => ({ ...body, attachments: [], memoryIds: [] }), notify() {}, kick() {} }); };
  let service = construct();
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return { get store() { return store; }, get service() { return service; }, at(value) { clock = new Date(value); }, advance(minutes) { clock = new Date(+clock + minutes * 60000); }, restart() { store.close(); store = new PersonalStore(dir); store.recover(); service = construct(); service.recover(); } };
}
const save = (f, overrides = {}) => { const previous = f.service.get('agent_codex'); return f.service.save('agent_codex', { version: previous.version, goal: { text: '整理自己的目标进展', status: 'active' }, scheduler: { ...previous.scheduler, enabled: true, ...overrides } }); };

test('goals are per contact, scheduling defaults off and unsupported backends cannot be enabled', async t => {
  const f = await setup(t), initial = f.service.get('agent_codex');
  assert.equal(initial.scheduler.enabled, false); assert.equal(initial.nextRunAt, null);
  f.store.put('contact', { id: 'human', kind: 'human', name: '朋友', version: 1 });
  assert.equal(f.service.get('human').supported, false);
  assert.throws(() => f.service.save('human', { version: 0, goal: { text: 'hello', status: 'active' }, scheduler: { ...initial.scheduler, enabled: true } }), /调度|支持/);
  f.service.save('human', { version: 0, goal: { text: '待办', status: 'paused' }, scheduler: initial.scheduler });
  assert.equal(f.service.get('agent_codex').goal.text, '');
  save(f); assert.throws(() => f.service.save('agent_codex', { version: 0, goal: initial.goal, scheduler: initial.scheduler }), /更新/);
});

test('missed interval slots coalesce, persist across restart and never overlap unresolved work', async t => {
  const f = await setup(t); save(f); f.advance(180);
  await f.service.tick(); await f.service.tick();
  let threads = f.store.list('thread'); assert.equal(threads.length, 1); assert.equal(threads[0].runs.length, 1);
  const first = threads[0].runs[0]; assert.equal(first.agentSchedule.goal.text, '整理自己的目标进展');
  assert.equal(threads[0].messages[0].role, 'system'); assert.notEqual(threads[0].messages[0].contactId, 'self');
  f.restart(); f.advance(240); await f.service.tick();
  assert.equal(f.store.list('thread')[0].runs.length, 1);
  f.store.updateThread(threads[0].id, thread => { thread.runs[0].status = 'unknown'; });
  f.service.afterRun(threads[0].id, first.id); await f.service.tick();
  assert.equal(f.service.get('agent_codex').state, 'blocked'); assert.equal(f.service.get('agent_codex').nextRunAt, null);
  assert.throws(() => f.service.runNow('agent_codex', { version: 1 }), /核查|正在/);
});

test('editing or pausing invalidates queued scheduling without changing immutable accepted input', async t => {
  const f = await setup(t); save(f); f.advance(60); await f.service.tick();
  const thread = f.store.list('thread')[0], run = thread.runs[0];
  const current = f.service.get('agent_codex');
  f.service.save('agent_codex', { version: current.version, goal: { text: '新目标', status: 'paused' }, scheduler: { ...current.scheduler, enabled: false } });
  assert.equal(f.service.beforeRun(thread, run), false);
  assert.equal(f.store.require('thread', thread.id).runs[0].status, 'cancelled');
  assert.equal(f.store.require('thread', thread.id).runs[0].agentSchedule.goal.text, '整理自己的目标进展');
  assert.equal(f.service.get('agent_codex').state, 'paused');
});

test('autonomous completion and bounded continuation are durable; malformed output cannot schedule', async t => {
  const f = await setup(t); save(f, { mode: 'autonomous', intervalMinutes: 15 });
  let accepted = f.service.runNow('agent_codex', { version: 1 });
  f.store.updateThread(accepted.threadId, thread => { Object.assign(thread.runs[0], { status: 'completed', goalDecision: parseGoalDecision(JSON.stringify({ reply: '已完成第一步', goalStatus: 'continue', nextRunMinutes: 30, reason: '等待下一次检查' })) }); });
  f.service.afterRun(accepted.threadId, accepted.runId);
  assert.equal(f.service.get('agent_codex').nextRunAt, '2026-11-11T01:30:00.000Z');
  f.restart(); assert.equal(f.service.get('agent_codex').nextRunAt, '2026-11-11T01:30:00.000Z');
  f.advance(30); await f.service.tick();
  const thread = f.store.require('thread', accepted.threadId), run = thread.runs.at(-1);
  f.store.updateThread(thread.id, item => { Object.assign(item.runs.at(-1), { status: 'completed', goalDecision: parseGoalDecision(JSON.stringify({ reply: '目标完成', goalStatus: 'completed', nextRunMinutes: null, reason: '结果已保存' })) }); });
  f.service.afterRun(thread.id, run.id); f.advance(60); await f.service.tick();
  assert.equal(f.service.get('agent_codex').goal.status, 'completed'); assert.equal(f.store.require('thread', thread.id).runs.length, 2);
  for (const value of ['plain text', '{"goalStatus":"continue"}', JSON.stringify({ reply: 'x', goalStatus: 'continue', nextRunMinutes: 0, reason: 'x' }), JSON.stringify({ reply: 'x', goalStatus: 'continue', nextRunMinutes: 30, reason: 'x', enabled: true })]) assert.throws(() => parseGoalDecision(value), /有效/);
});

test('daily local times handle DST gaps and repeats without double slots', () => {
  assert.equal(nextDailyRun(new Date('2026-11-11T01:00:00Z'), '09:00', 'Asia/Shanghai'), '2026-11-12T01:00:00.000Z');
  assert.equal(nextDailyRun(new Date('2026-03-08T06:00:00Z'), '02:30', 'America/New_York'), '2026-03-09T06:30:00.000Z');
  assert.equal(nextDailyRun(new Date('2026-11-01T05:30:00Z'), '01:30', 'America/New_York'), '2026-11-02T06:30:00.000Z');
});

test('daily budget includes manual triggers and model continuation cannot lift it', async t => {
  const f = await setup(t); save(f, { mode: 'autonomous', intervalMinutes: 15, maxRunsPerDay: 1 });
  const accepted = f.service.runNow('agent_codex', { version: 1 });
  f.store.updateThread(accepted.threadId, thread => { Object.assign(thread.runs[0], { status: 'completed', goalDecision: { reply: '继续', goalStatus: 'continue', nextRunMinutes: 15, reason: '继续检查' } }); });
  f.service.afterRun(accepted.threadId, accepted.runId);
  assert.equal(f.service.get('agent_codex').nextRunAt, '2026-11-11T16:00:00.000Z');
  assert.throws(() => f.service.runNow('agent_codex', { version: 1 }), /每日/);
  f.advance(15); await f.service.tick(); assert.equal(f.store.list('thread')[0].runs.length, 1);
  f.advance(24 * 60); await f.service.tick(); assert.equal(f.store.list('thread')[0].runs.length, 2);
});

test('enabling again cannot hide unknown runs behind a scheduled state', async t => {
  const f = await setup(t); save(f); const accepted = f.service.runNow('agent_codex', { version: 1 });
  f.store.updateThread(accepted.threadId, thread => { thread.runs[0].status = 'unknown'; });
  f.service.afterRun(accepted.threadId, accepted.runId);
  assert.throws(() => save(f), /核查/);
});

test('a queued goal crossing midnight consumes its actual execution day budget', async t => {
  const f = await setup(t); save(f, { maxRunsPerDay: 1, intervalMinutes: 15 });
  const accepted = f.service.runNow('agent_codex', { version: 1 }); f.advance(15 * 60);
  let thread = f.store.require('thread', accepted.threadId);
  assert.equal(f.service.get('agent_codex').runsToday, 0);
  assert.equal(f.service.beforeRun(thread, thread.runs[0]), true);
  assert.equal(f.service.get('agent_codex').runsToday, 1);
  f.store.updateThread(thread.id, item => { item.runs[0].status = 'completed'; });
  f.service.afterRun(thread.id, accepted.runId); f.advance(15); await f.service.tick();
  assert.equal(f.store.require('thread', thread.id).runs.length, 1);
  assert.equal(f.service.get('agent_codex').nextRunAt, '2026-11-12T16:00:00.000Z');
});

test('owner messages pass a queued goal but never unknown executions, and daily DST completion skips repeated slot', async t => {
  const f = await setup(t); f.at('2026-11-01T05:00:00Z'); save(f, { mode: 'daily', time: '01:30', timeZone: 'America/New_York' });
  f.advance(30); await f.service.tick();
  const thread = f.store.list('thread')[0], scheduled = thread.runs[0];
  f.store.appendRun(thread, { text: 'Owner priority', mode: 'local', contactId: 'agent_codex' }); f.store.put('thread', thread);
  assert.equal(f.store.nextQueuedRun(thread).id, thread.runs[1].id);
  f.store.updateThread(thread.id, item => { item.runs[1].status = 'unknown'; });
  assert.equal(f.service.beforeRun(f.store.require('thread', thread.id), scheduled), false);
  const newer = f.service.get('agent_codex');
  f.store.updateThread(thread.id, item => { item.runs[1].status = 'completed'; });
  f.service.save('agent_codex', { version: newer.version, goal: newer.goal, scheduler: newer.scheduler });
  f.advance(40); const accepted = f.service.runNow('agent_codex', { version: 2 });
  f.store.updateThread(thread.id, item => { item.runs.at(-1).status = 'completed'; });
  f.service.afterRun(thread.id, accepted.runId);
  assert.equal(f.service.get('agent_codex').nextRunAt, '2026-11-02T06:30:00.000Z');
});

test('remote schedules bind the accepted account and never claim structured autonomous support', async t => {
  const f = await setup(t);
  f.store.put('connection', { id: 'con_remote', type: 'a2a', name: 'Remote', url: 'http://127.0.0.1:1/rpc', credentialVersion: 1 });
  f.store.put('contact', { id: 'remote', kind: 'agent', name: 'Remote', handle: 'remote', version: 1, binding: { type: 'connection', connectionId: 'con_remote' } });
  const initial = f.service.get('remote'); assert.equal(initial.supported, true); assert.equal(initial.autonomousSupported, false);
  const body = { version: 0, goal: { text: '固定目标', status: 'active' }, scheduler: { ...initial.scheduler, enabled: true } };
  assert.throws(() => f.service.save('remote', { ...body, scheduler: { ...body.scheduler, mode: 'autonomous' } }), /不支持自主/);
  f.service.save('remote', body);
  f.store.put('connection', { ...f.store.require('connection', 'con_remote'), credentialVersion: 2 });
  assert.throws(() => f.service.runNow('remote', { version: 1 }), /身份已变化/);
  assert.equal(f.store.list('thread').length, 0);
});

test('queued cancel stops the policy, retries obey current controls, and paused remote receipts can still reconcile', async t => {
  const { createPersonalServer } = await import('./index.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'agentstudio-goal-cancel-'));
  const app = await createPersonalServer({ dataDir: dir, port: 0, schedulerTickMs: 0, codexCommand: process.execPath, discoverLocalAgents: async () => detected });
  app.worker.closed = true; await app.listen();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const api = async (path, body) => { const response = await fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, body: await response.json() }; };
  const control = (await api('/contacts/agent_codex/control')).body;
  await api('/contacts/agent_codex/control', { version: 0, clientId: 'queued-save-key', goal: { text: '检查', status: 'active' }, scheduler: { ...control.scheduler, enabled: true } });
  const accepted = (await api('/contacts/agent_codex/run', { version: 1, clientId: 'queued-run-key' })).body;
  await api(`/threads/${accepted.threadId}/cancel`, { runId: accepted.runId, clientId: 'queued-cancel-key' });
  assert.equal(app.scheduler.get('agent_codex').state, 'blocked'); assert.equal(app.scheduler.get('agent_codex').nextRunAt, null);
  const retry = await api(`/threads/${accepted.threadId}/retry`, { runId: accepted.runId, clientId: 'queued-retry-key' });
  assert.equal(retry.status, 409); assert.equal(retry.body.error.code, 'goal_retry_policy');
  const saved = app.scheduler.get('agent_codex');
  await api('/contacts/agent_codex/control', { version: 1, clientId: 'queued-pause-key', goal: { ...saved.goal, status: 'paused' }, scheduler: { ...saved.scheduler, enabled: false } });
  const thread = app.store.require('thread', accepted.threadId), run = thread.runs[0];
  Object.assign(run, { phase: 'reconcile', externalTaskId: 'receipt-to-read' });
  assert.equal(app.scheduler.beforeRun(thread, run), true);
});

test('native API uses the shared worker, idempotent run receipts and validated autonomous output', async t => {
  const { createPersonalServer } = await import('./index.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'agentstudio-goal-http-')), changes = new EventEmitter(), calls = [], seenProgress = [];
  const app = await createPersonalServer({ dataDir: dir, port: 0, schedulerTickMs: 0, schedulerNow: () => new Date('2026-11-11T01:00:00Z'), codexCommand: process.execPath,
    discoverLocalAgents: async () => ({ ...detected, checkedAt: '2026-11-11T01:00:00Z' }), executeLocalAgent: async request => {
      calls.push(request); request.onEvent?.({ type: 'progress', phase: 'reply', text: '{"reply":"PRIVATE_ENVELOPE"' });
      return { markdown: JSON.stringify({ reply: '本次目标已完成', goalStatus: 'completed', nextRunMinutes: null, reason: '已经保存结果' }) };
    }, onChange: () => { seenProgress.push(...(app?.store.list('thread') || []).flatMap(thread => thread.runs.map(run => run.progress?.text || ''))); changes.emit('change'); } });
  await app.listen(); t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  let sequence = 0;
  const api = async (path, body) => { const response = await fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, body: await response.json() }; };
  const previous = (await api('/contacts/agent_codex/control')).body;
  const input = { version: previous.version, clientId: `goal-save-${++sequence}`, goal: { text: '仅处理这个目标', status: 'active' }, scheduler: { ...previous.scheduler, mode: 'autonomous', enabled: true } };
  const saved = await api('/contacts/agent_codex/control', input); assert.equal(saved.status, 200);
  assert.deepEqual((await api('/contacts/agent_codex/control', input)).body, saved.body);
  assert.equal((await api('/contacts/agent_codex/control', { ...input, clientId: 'stale-request' })).status, 409);
  const trigger = { version: saved.body.version, clientId: 'manual-trigger-unique' };
  const accepted = await api('/contacts/agent_codex/run', trigger); assert.equal(accepted.status, 202);
  assert.deepEqual((await api('/contacts/agent_codex/run', trigger)).body, accepted.body);
  await new Promise((resolve, reject) => {
    const check = () => { if (app.scheduler.get('agent_codex').goal.status === 'completed') { clearTimeout(timer); changes.off('change', check); resolve(); } };
    const timer = setTimeout(() => { changes.off('change', check); reject(new Error('Goal did not complete')); }, 3000); changes.on('change', check); check();
  });
  assert.equal(calls.length, 1); assert.ok(calls[0].prompt.includes('仅处理这个目标'));
  assert.ok(!seenProgress.some(text => text.includes('PRIVATE_ENVELOPE')));
  const thread = app.store.require('thread', accepted.body.threadId);
  assert.equal(thread.messages.at(-1).text, '本次目标已完成'); assert.equal(thread.decisions.length, 0);
  assert.equal(app.scheduler.get('agent_codex').scheduler.enabled, false);
  assert.equal((await api('/host/discovery')).body.readyContacts[0].contactId, 'agent_codex');
});
