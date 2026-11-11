import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PersonalStore } from './store.mjs';
import { PersonalWorker } from './runtime.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentstudio-concurrent-'));
  const store = new PersonalStore(dir), events = new EventEmitter(), entered = [], releases = new Map();
  const worker = new PersonalWorker(store, options, () => events.emit('change'));
  worker.execute = async (threadId, runId, signal) => {
    const gate = deferred(); releases.set(runId, gate.resolve); entered.push(runId); events.emit('change');
    await Promise.race([gate.promise, new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))]);
    if (!signal.aborted) worker.change(threadId, runId, (_thread, run) => { run.status = 'completed'; });
  };
  t.after(async () => { await worker.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const wait = predicate => new Promise((resolve, reject) => {
    const check = () => { if (predicate()) { clearTimeout(timer); events.off('change', check); resolve(); } };
    const timer = setTimeout(() => { events.off('change', check); reject(new Error('Expected worker transition did not happen')); }, 700);
    events.on('change', check); check();
  });
  let sequence = 0;
  const chat = (kind = 'group') => store.put('thread', { id: `thread-${++sequence}`, kind, memberIds: ['self', 'a', 'b', 'c', 'd'], members: [], messages: [], runs: [], events: [], artifacts: [], decisions: [], memoryIds: [] });
  const enqueue = (thread, contactId, extra = {}) => {
    const current = store.require('thread', thread.id);
    const run = store.appendRun(current, { text: 'Synthetic message', mode: 'codex', contactId, contactSnapshot: { id: contactId, name: contactId }, participantSnapshot: [], ...extra });
    store.put('thread', current); return run;
  };
  return { store, worker, entered, releases, wait, chat, enqueue };
}

test('independent group members start reading before a slow first member responds', async t => {
  const f = fixture(t), chat = f.chat();
  const a = f.enqueue(chat, 'a'), b = f.enqueue(chat, 'b');
  f.worker.start();
  await f.wait(() => f.entered.includes(b.id));
  assert.equal(f.store.require('thread', chat.id).runs.find(r => r.id === a.id).status, 'running');
  f.releases.get(b.id)(); await f.wait(() => f.store.require('thread', chat.id).runs[1].status === 'completed');
  assert.equal(f.store.require('thread', chat.id).runs[0].status, 'running');
});

test('same member follow-ups stay ordered while another member can proceed', async t => {
  const f = fixture(t), chat = f.chat();
  const first = f.enqueue(chat, 'a'), followup = f.enqueue(chat, 'a'), peer = f.enqueue(chat, 'b');
  f.worker.start(); await f.wait(() => f.entered.includes(peer.id));
  assert.equal(f.entered.includes(followup.id), false);
  f.releases.get(first.id)(); await f.wait(() => f.entered.includes(followup.id));
});

test('progress and stop target one invocation without aborting another', async t => {
  const f = fixture(t), chat = f.chat();
  const a = f.enqueue(chat, 'a'), b = f.enqueue(chat, 'b');
  f.worker.start(); await f.wait(() => f.entered.includes(b.id));
  f.worker.progress(chat.id, a.id, { phase: 'writing', text: 'a partial' });
  f.worker.progress(chat.id, b.id, { phase: 'writing', text: 'b partial' });
  assert.deepEqual(f.store.require('thread', chat.id).runs.map(r => r.progress.text), ['a partial', 'b partial']);
  f.worker.cancel(chat.id, a.id);
  f.releases.get(b.id)(); await f.wait(() => f.store.require('thread', chat.id).runs[1].status === 'completed');
});

test('bounded pool admits the next eligible run as soon as any slot is free', async t => {
  const f = fixture(t, { maxConcurrentRuns: 2 }), chat = f.chat();
  const runs = ['a', 'b', 'c'].map(id => f.enqueue(chat, id));
  f.worker.start(); await f.wait(() => f.entered.length === 2);
  assert.equal(f.entered.includes(runs[2].id), false);
  f.releases.get(runs[1].id)(); await f.wait(() => f.entered.includes(runs[2].id));
});

test('different contacts sharing one remote URL serialize across conversations', async t => {
  const f = fixture(t), one = f.chat(), two = f.chat();
  f.store.put('connection', { id: 'remote-one', type: 'a2a', url: 'https://example.invalid/agent' });
  f.store.put('connection', { id: 'remote-two', type: 'a2a', url: 'https://example.invalid/agent' });
  const a = f.enqueue(one, 'a', { mode: 'connection', connectionId: 'remote-one' });
  const b = f.enqueue(two, 'b', { mode: 'connection', connectionId: 'remote-two' });
  const local = f.enqueue(two, 'c');
  f.worker.start(); await f.wait(() => f.entered.includes(local.id));
  assert.equal(f.entered.includes(a.id), true); assert.equal(f.entered.includes(b.id), false);
  f.releases.get(a.id)(); await f.wait(() => f.entered.includes(b.id));
});

test('unknown shared remote work blocks that session while independent work continues', async t => {
  const f = fixture(t), one = f.chat(), two = f.chat();
  f.store.put('connection', { id: 'remote', type: 'a2a', url: 'https://example.invalid/agent' });
  const unknown = f.enqueue(one, 'a', { mode: 'connection', connectionId: 'remote' });
  f.store.updateThread(one.id, item => { item.runs[0].status = 'unknown'; });
  const pending = f.enqueue(two, 'b', { mode: 'connection', connectionId: 'remote' }), local = f.enqueue(two, 'c');
  f.worker.start(); await f.wait(() => f.entered.includes(local.id));
  assert.equal(f.entered.includes(pending.id), false); assert.equal(f.entered.includes(unknown.id), false);
});

test('an unknown remote barrier retains its accepted URL after the binding is edited', async t => {
  const f = fixture(t), one = f.chat(), two = f.chat();
  f.store.put('connection', { id: 'remote', type: 'a2a', url: 'https://example.invalid/accepted' });
  const unknown = f.enqueue(one, 'a', { mode: 'connection', connectionId: 'remote' });
  f.store.updateThread(one.id, item => { item.runs[0].status = 'unknown'; });
  f.store.put('connection', { id: 'remote', type: 'a2a', url: 'https://example.invalid/edited' });
  f.store.put('connection', { id: 'duplicate', type: 'a2a', url: 'https://example.invalid/accepted' });
  const pending = f.enqueue(two, 'b', { mode: 'connection', connectionId: 'duplicate' }), local = f.enqueue(two, 'c');
  f.worker.start(); await f.wait(() => f.entered.includes(local.id));
  assert.equal(f.entered.includes(pending.id), false); assert.equal(f.entered.includes(unknown.id), false);
});

test('shared remote uncertainty blocks both legacy-to-contact and contact-to-legacy submission', async t => {
  for (const [oldContact, newContact] of [[null, 'b'], ['a', null]]) {
    const f = fixture(t), one = f.chat(), two = f.chat();
    f.store.put('connection', { id: 'remote', type: 'a2a', url: 'https://example.invalid/shared' });
    f.enqueue(one, oldContact, { mode: 'connection', connectionId: 'remote' });
    f.store.updateThread(one.id, item => { item.runs[0].status = 'unknown'; });
    const pending = f.enqueue(two, newContact, { mode: 'connection', connectionId: 'remote' }), local = f.enqueue(two, 'c');
    f.worker.start(); await f.wait(() => f.entered.includes(local.id));
    assert.equal(f.entered.includes(pending.id), false);
  }
});

test('original taskId reconciliation can cross another historical unknown while sends remain blocked', async t => {
  const f = fixture(t), one = f.chat(), two = f.chat();
  f.store.put('connection', { id: 'remote', type: 'a2a', url: 'https://example.invalid/shared' });
  const read = f.enqueue(one, 'a', { mode: 'connection', connectionId: 'remote' });
  f.store.updateThread(one.id, item => { Object.assign(item.runs[0], { phase: 'reconcile', externalTaskId: 'original-task', requiresReconciliation: true }); });
  f.enqueue(two, 'b', { mode: 'connection', connectionId: 'remote' });
  f.store.updateThread(two.id, item => { item.runs[0].status = 'unknown'; });
  f.worker.start(); await f.wait(() => f.entered.includes(read.id));
  assert.deepEqual(f.entered, [read.id]);
});
