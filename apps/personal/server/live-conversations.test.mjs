import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createPersonalServer } from './index.mjs';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'live-contact-')), directory = join(home, '.pi/agent');
  await mkdir(directory, { recursive: true });
  const cli = join(home, 'pi'), trace = join(home, 'trace.jsonl'), release = join(home, 'release');
  await writeFile(cli, await readFile(new URL('../../../dev/fixtures/live-pi.cjs', import.meta.url)), { mode: 0o700 });
  const defaults = model => writeFile(join(directory, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: model, defaultThinkingLevel: 'high', modelThinkingLevels: { 'fixture/beta': 'low' } }));
  await defaults('alpha');
  const changes = new EventEmitter();
  const app = await createPersonalServer({ dataDir: join(home, 'data'), port: 0, codexCommand: '/missing-synthetic-codex',
    localAgentDeps: { home, env: { ...process.env, PI_CODING_AGENT_DIR: directory, AGENTSTUDIO_SYNTHETIC_TRACE: trace, AGENTSTUDIO_SYNTHETIC_RELEASE: release }, commands: { pi: cli, codex: '/missing-synthetic-codex', claude: '/missing-synthetic-claude', gemini: '/missing-synthetic-gemini', opencode: '/missing-synthetic-opencode' }, spawn: (command, args, options) => spawn(process.execPath, [command, ...args], options) }, onChange: () => changes.emit('change') });
  await app.listen(); t.after(async () => { await app.close(); await rm(home, { recursive: true, force: true }); });
  let sequence = 0;
  const api = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify({ ...body, clientId: `synthetic-live-${++sequence}` }) : undefined });
    const value = await r.json(); assert.ok(r.ok, JSON.stringify(value)); return value;
  };
  const wait = (id, predicate) => new Promise((resolve, reject) => {
    const check = () => { const thread = app.store.get('thread', id); if (predicate(thread)) { clearTimeout(timer); changes.off('change', check); resolve(thread); } };
    const timer = setTimeout(() => { changes.off('change', check); reject(new Error('Synthetic live conversation timed out')); }, 12000); changes.on('change', check); check();
  });
  await api('/contacts');
  const contact = await api('/contacts', { kind: 'agent', name: '合成 Pi', handle: 'syntheticpi', binding: { type: 'local', localAgentId: 'pi' } });
  const chat = await api('/chats', { kind: 'direct', memberIds: [contact.id] });
  return { app, api, wait, contact, chat, defaults, trace, release: () => writeFile(release, 'release') };
}

test('Pi contact sends through HTTP, streams, queues causally and freezes model defaults at acceptance', async t => {
  const f = await fixture(t);
  await f.api(`/threads/${f.chat.id}/messages`, { text: '第一问 FIRST' });
  const live = await f.wait(f.chat.id, thread => Boolean(thread.runs[0]?.progress?.text));
  assert.equal(live.artifacts.length, 0); assert.equal(live.runs[0].status, 'running');
  await f.api(`/threads/${f.chat.id}/messages`, { text: '第二问 SECOND' });
  await f.defaults('beta'); await f.api('/contacts');
  await f.api(`/threads/${f.chat.id}/messages`, { text: '第三问 THIRD' });
  const accepted = f.app.store.get('thread', f.chat.id);
  assert.deepEqual(accepted.runs.map(run => run.executionSnapshot.model), ['alpha', 'alpha', 'beta']);
  assert.equal(accepted.runs[2].executionSnapshot.thinking, 'low');
  await f.release(); const done = await f.wait(f.chat.id, thread => thread.runs.length === 3 && thread.runs.every(run => run.status === 'completed'));
  assert.equal(done.artifacts.length, 3); assert.ok(done.runs.every(run => !run.progress));
  const calls = (await readFile(f.trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.model), ['alpha', 'alpha', 'beta']);
  assert.ok(calls[1].context.messages.some(message => message.role === 'assistant' && message.text.includes('FIRST_REPLY')));
  assert.ok(!JSON.stringify(calls[1].context).includes('第三问 THIRD'));
  assert.ok(!JSON.stringify(done).includes('SYNTHETIC_PRIVATE_THINKING'));
});

test('partial Pi failure keeps incomplete progress but produces no completed artifact', async t => {
  const f = await fixture(t);
  await f.api(`/threads/${f.chat.id}/messages`, { text: 'FAIL_ZERO' });
  const done = await f.wait(f.chat.id, thread => thread.runs[0]?.status === 'blocked');
  assert.equal(done.artifacts.length, 0); assert.equal(done.messages.filter(message => message.role === 'assistant').length, 0);
  assert.ok(done.runs[0].progress.text.includes('第一段'));
});

test('scratch conversations and retries keep the model accepted with the original question', async t => {
  const f = await fixture(t);
  const thread = await f.api('/threads', { text: 'FIRST', localAgentId: 'pi' });
  await f.wait(thread.id, value => Boolean(value.runs[0]?.progress?.text));
  await f.api(`/threads/${thread.id}/messages`, { text: 'SECOND', localAgentId: 'pi' });
  await f.defaults('beta');
  const accepted = f.app.store.get('thread', thread.id);
  assert.deepEqual(accepted.runs.map(run => run.executionSnapshot.model), ['alpha', 'alpha']);
  await f.api(`/threads/${thread.id}/cancel`, { runId: accepted.runs[1].id });
  await f.api(`/threads/${thread.id}/retry`, { runId: accepted.runs[1].id });
  assert.equal(f.app.store.get('thread', thread.id).runs[2].executionSnapshot.model, 'alpha');
  await f.release(); await f.wait(thread.id, value => value.runs[2]?.status === 'completed');
  const calls = (await readFile(f.trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.map(call => call.model), ['alpha', 'alpha']);
});
