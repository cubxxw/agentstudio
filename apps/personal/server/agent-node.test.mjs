import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentNode } from './agent-node.mjs';
import { LocalAgentError } from './local-agents.mjs';

const token = 'synthetic-node-token-32-characters-long';
const payload = (messageId, text = 'hello') => ({ message: { kind: 'message', role: 'user', messageId, parts: [{ kind: 'text', text }] }, configuration: { blocking: false } });
async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentroom-node-'));
  let node;
  const start = async options => {
    node = await createAgentNode({ dataDir, token, port: 0, name: 'Synthetic server', agents: ['codex', 'claude'],
      execute: async () => ({ markdown: 'Remote answer', identity: { id: 'codex' } }), ...extra, ...options });
    const address = await node.listen();
    return `http://127.0.0.1:${address.port}`;
  };
  const base = await start();
  t.after(async () => { await node.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { node, base, restart: async options => { await node.close(); return start(options); } };
}
async function call(base, method, params, agent = 'codex') {
  const response = await fetch(`${base}/agents/${agent}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'rpc-test', method, params }) });
  return { status: response.status, ...await response.json() };
}
async function completed(base, taskId) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await call(base, 'tasks/get', { id: taskId });
    if (result.result?.status.state === 'completed') return result.result;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('node did not finish');
}

test('manifest and tasks require bearer; browsers and unconfigured agents are rejected', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(base + '/.well-known/agentroom-node.json')).status, 401);
  const response = await fetch(base + '/.well-known/agentroom-node.json', { headers: { authorization: `Bearer ${token}` } });
  const manifest = await response.json();
  assert.equal(response.status, 200); assert.equal(manifest.protocol, 'agentroom-node/1');
  assert.deepEqual(manifest.agents.map(a => a.id), ['codex', 'claude']);
  assert.ok(manifest.id.startsWith('node_')); assert.ok(!JSON.stringify(manifest).includes(token));
  assert.equal((await fetch(base + '/.well-known/agentroom-node.json', { headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(base, 'message/send', payload('unknown-agent'), 'pi')).status, 404);
});

test('same message persists once, changed replay conflicts, and another agent cannot read its result', async t => {
  let executions = 0;
  const { base } = await fixture(t, { execute: async () => { executions++; return { markdown: 'A real stored response' }; } });
  const first = await call(base, 'message/send', payload('stable-message-1'));
  assert.equal(first.result.id, 'stable-message-1');
  const result = await completed(base, first.result.id);
  assert.equal(result.artifacts[0].parts[0].text, 'A real stored response');
  assert.equal((await call(base, 'message/send', payload('stable-message-1'))).result.id, result.id);
  assert.equal((await call(base, 'message/send', payload('stable-message-1', 'different'))).status, 409);
  assert.equal((await call(base, 'tasks/get', { id: result.id }, 'claude')).status, 404);
  assert.equal(executions, 1);
});

test('durable result and node identity survive restart without another execution', async t => {
  const f = await fixture(t);
  const before = await (await fetch(f.base + '/.well-known/agentroom-node.json', { headers: { authorization: `Bearer ${token}` } })).json();
  await call(f.base, 'message/send', payload('durable-message-1')); await completed(f.base, 'durable-message-1');
  const base = await f.restart({ execute: () => { throw new Error('must never rerun'); } });
  const after = await (await fetch(base + '/.well-known/agentroom-node.json', { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(after.id, before.id);
  assert.equal((await call(base, 'tasks/get', { id: 'durable-message-1' })).result.status.state, 'completed');
});

test('interrupted execution becomes uncertain and replay cannot relaunch it', async t => {
  let started;
  const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { execute: ({ signal }) => new Promise((_resolve, reject) => {
    started(); signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
  }) });
  await call(f.base, 'message/send', payload('interrupted-message')); await begun;
  const base = await f.restart({ execute: () => { throw new Error('must not relaunch'); } });
  const replay = await call(base, 'message/send', payload('interrupted-message'));
  assert.equal(replay.result.status.state, 'unknown'); assert.equal(replay.result.metadata.uncertain, true);
});

test('node serializes execution across agents and resumes queued tasks after restart', async t => {
  let started;
  const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { execute: ({ signal }) => new Promise((_resolve, reject) => {
    started(); signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true });
  }) });
  await call(f.base, 'message/send', payload('first-running')); await begun;
  const second = await call(f.base, 'message/send', payload('second-queued'));
  assert.equal(second.result.status.state, 'submitted');
  const base = await f.restart({ execute: async () => ({ markdown: 'Resumed queued response' }) });
  assert.equal((await completed(base, 'second-queued')).status.state, 'completed');
});

test('node refuses command injection, empty or oversized inputs and public bind addresses', async t => {
  const { base } = await fixture(t);
  assert.equal((await call(base, 'message/send', { ...payload('bad-command'), command: 'sh' })).status, 400);
  assert.equal((await call(base, 'message/send', payload('empty-message', ''))).status, 400);
  assert.equal((await call(base, 'message/send', payload('large-message', 'x'.repeat(2_000_001)))).status, 413);
  await assert.rejects(createAgentNode({ dataDir: '/nonexistent', token, agents: ['codex'], host: '0.0.0.0' }), /loopback/);
});

test('unconfirmed child stop fences the durable queue across node restarts', async t => {
  const f = await fixture(t, { execute: async () => { throw new LocalAgentError('stop_unconfirmed'); } });
  await call(f.base, 'message/send', payload('uncertain-process'));
  await untilUnknown();
  const base = await f.restart({ execute: async () => ({ markdown: 'Must not start while a prior child might be alive' }) });
  await call(base, 'message/send', payload('must-remain-queued'));
  assert.equal((await call(base, 'tasks/get', { id: 'must-remain-queued' })).result.status.state, 'submitted');
  assert.equal((await call(base, 'tasks/get', { id: 'uncertain-process' })).result.status.state, 'unknown');
  async function untilUnknown() {
    for (let i = 0; i < 100; i++) {
      if ((await call(f.base, 'tasks/get', { id: 'uncertain-process' })).result.status.state === 'unknown') return;
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('uncertain stop was reported as an ordinary failure');
  }
});

test('shutdown persists an unconfirmed stop before allowing a replacement node', async t => {
  let started;
  const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { execute: ({ signal }) => new Promise((_resolve, reject) => {
    started(); signal.addEventListener('abort', () => reject(new LocalAgentError('stop_unconfirmed')), { once: true });
  }) });
  await call(f.base, 'message/send', payload('shutdown-uncertain')); await begun;
  await call(f.base, 'message/send', payload('shutdown-queued'));
  const base = await f.restart({ execute: async () => ({ markdown: 'Must stay fenced' }) });
  assert.equal((await call(base, 'tasks/get', { id: 'shutdown-queued' })).result.status.state, 'submitted');
});

test('recovery from an unexpected node death fences potentially surviving detached children', async t => {
  const f = await fixture(t);
  f.node.store.put('node_task', { id: 'crashed-task', agentId: 'codex', state: 'working', message: payload('crashed-task').message });
  f.node.store.put('node_task', { id: 'crash-queued', agentId: 'codex', state: 'submitted', message: payload('crash-queued').message });
  const base = await f.restart();
  assert.equal((await call(base, 'tasks/get', { id: 'crashed-task' })).result.status.state, 'unknown');
  assert.equal((await call(base, 'tasks/get', { id: 'crash-queued' })).result.status.state, 'submitted');
});
