import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentNode } from './agent-node.mjs';
import { createPersonalServer } from './index.mjs';

const token = 'synthetic-node-credential-private-123456';
const discover = async () => ({ agents: [] });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agentroom-enrollment-'));
  let executions = 0;
  const node = await createAgentNode({ dataDir: join(root, 'node'), token, port: 0, agents: ['codex', 'claude'], name: 'Test server',
    discover: async () => ({ agents: ['codex', 'claude'].map(id => ({ id, installed: true, auth: { status: 'configured' } })) }),
    execute: async () => { executions++; return { markdown: 'Synthetic node answer' }; } });
  const n = await node.listen(), url = `http://127.0.0.1:${n.port}`;
  const app = await createPersonalServer({ dataDir: join(root, 'mac'), port: 0, discoverLocalAgents: discover, codexCommand: '/missing-synthetic', remotePollMs: 5 });
  const address = await app.listen();
  t.after(async () => { await app.close(); await node.close(); await rm(root, { recursive: true, force: true }); });
  const request = async (path, body, method) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method: method || (body ? 'POST' : 'GET'),
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { root, app, node, url, request, executions: () => executions };
}
async function until(probe) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error('Expected persisted state did not arrive');
}

test('one enrollment adds all node agents, replay is stable and no token enters public data or SQLite', async t => {
  const { request, app, root, url } = await fixture(t);
  const input = { url, token, clientId: 'enroll-request-1' };
  const first = await request('/nodes/connect', input);
  assert.equal(first.status, 201); assert.equal(first.body.connections.length, 2);
  assert.deepEqual((await request('/nodes/connect', input)).body, first.body);
  assert.equal(app.store.list('connection').length, 2);
  const contacts = (await request('/contacts')).body.contacts;
  assert.equal(contacts.filter(c => c.binding?.type === 'connection').length, 2);
  assert.ok(!JSON.stringify((await request('/integrations')).body).includes(token));
  assert.ok(!(await readFile(join(root, 'mac', 'personal.sqlite'))).includes(Buffer.from(token)));
  assert.ok(first.body.connections.every(c => c.node.id === first.body.node.id));
});

test('invalid credentials fail before adding anything and changed enrollment cannot replace old authority', async t => {
  const { request, url, app } = await fixture(t);
  assert.equal((await request('/nodes/connect', { url, token: 'wrong-synthetic-node-token-123456789' })).status, 401);
  assert.equal(app.store.list('connection').length, 0);
  assert.equal((await request('/nodes/connect', { url, token })).status, 201);
  assert.equal((await request('/nodes/connect', { url, token: 'changed-synthetic-token-123456789' })).status, 409);
  assert.equal(app.store.list('connection').length, 2);
});

test('node check reports fresh observations; removing its connections removes it from the catalog', async t => {
  const { request, url } = await fixture(t);
  const added = (await request('/nodes/connect', { url, token })).body;
  const check = await request(`/nodes/${added.node.id}/check`, {});
  assert.equal(check.status, 200); assert.equal(check.body.status, 'reachable'); assert.ok(check.body.checkedAt);
  for (const c of added.connections) assert.equal((await request(`/connections/${c.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await request('/integrations')).body.nodes.length, 0);
});

test('contact presence expires and a failed check preserves the last directory and last successful timestamp', async t => {
  const { request, url, app, node } = await fixture(t);
  const added = (await request('/nodes/connect', { url, token })).body;
  let people = (await request('/contacts')).body.contacts;
  const imported = people.find(c => c.binding?.type === 'connection');
  assert.equal(imported.presence.state, 'online');
  const stamp = imported.presence.lastSeenAt;
  await node.close();
  assert.equal((await request(`/nodes/${added.node.id}/check`, {})).status, 502);
  people = (await request('/contacts')).body.contacts;
  assert.equal(people.find(c => c.id === imported.id).presence.state, 'reconnecting');
  assert.equal(people.find(c => c.id === imported.id).presence.lastSeenAt, stamp);
  const stored = app.store.require('remote_node', added.node.id);
  app.store.put('remote_node', { ...stored, lastSeenAt: new Date(Date.now() - 65_000).toISOString() });
  const offline = (await request('/contacts')).body.contacts.find(c => c.id === imported.id);
  assert.equal(offline.presence.state, 'offline'); assert.equal(offline.availability, 'disconnected');
  assert.equal((await request('/integrations')).body.nodes[0].agents.length, 2);
});

test('lost first receipt reconciles by pre-persisted task id with exactly one remote execution', async t => {
  const f = await fixture(t);
  const added = (await f.request('/nodes/connect', { url: f.url, token })).body;
  const original = f.app.worker.callRPC.bind(f.app.worker); let sends = 0;
  f.app.worker.callRPC = async (...args) => {
    const result = await original(...args);
    if (args[1] === 'message/send') { sends++; throw new Error('synthetic lost receipt after persistence'); }
    return result;
  };
  const chat = (await f.request('/chats', { kind: 'direct', memberIds: ['self', `connection_${added.connections[0].id}`], clientId: 'create-node-chat' })).body;
  await f.request(`/threads/${chat.id}/messages`, { text: 'hello remote server', clientId: 'send-node-message' });
  const unknown = await until(() => { const current = f.app.store.get('thread', chat.id); return current.status === 'unknown' && current; });
  assert.equal(unknown.runs[0].externalTaskId, unknown.runs[0].id);
  await f.request(`/threads/${chat.id}/reconcile`, { clientId: 'reconcile-node-run' });
  const done = await until(() => { const current = f.app.store.get('thread', chat.id); return current.status === 'completed' && current; });
  assert.ok(done.messages.some(m => m.text.includes('Synthetic node answer')));
  assert.equal(sends, 1); assert.equal(f.executions(), 1);
});

test('manifest cannot redirect credentials or register partial hostile catalogs', async t => {
  const { request, app } = await fixture(t);
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({
    protocol: 'agentroom-node/1', id: 'node_hostile', name: 'Hostile', agents: [
      { id: 'codex', name: 'Codex', url: `http://127.0.0.1:${server.address().port}/agents/codex`, taskIdScheme: 'messageId' },
      { id: 'claude', name: 'Claude', url: 'https://evil.example/agents/claude', taskIdScheme: 'messageId' },
    ],
  })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await request('/nodes/connect', { url: `http://127.0.0.1:${server.address().port}`, token })).status, 400);
  assert.equal(app.store.list('connection').length, 0);
});

for (const conflict of ['identity', 'credential']) test(`concurrent enrollment cannot race around the ${conflict} guard`, async t => {
  const { request, app } = await fixture(t);
  const waiting = [];
  const server = http.createServer((_req, response) => {
    waiting.push(response);
    if (waiting.length === 2) waiting.forEach((res, index) => {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ protocol: 'agentroom-node/1',
        id: conflict === 'identity' ? `node_race${index}` : 'node_race', name: 'Race', agents: [
          { id: 'codex', name: 'Codex', url: `http://127.0.0.1:${server.address().port}/agents/codex`, taskIdScheme: 'messageId' },
        ] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const results = await Promise.all([request('/nodes/connect', { url, token }), request('/nodes/connect', { url, token: conflict === 'credential' ? 'another-synthetic-credential-12345678' : token })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(app.store.list('connection').length, 1);
});

test('a withdrawn remote agent stays visible and removable in the node catalog', async t => {
  const { request, app } = await fixture(t); let withdrawn = false;
  const server = http.createServer((_req, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ protocol: 'agentroom-node/1', id: 'node_withdrawn', name: 'Server',
      agents: (withdrawn ? ['codex'] : ['codex', 'claude']).map(id => ({ id, name: id, url: `http://127.0.0.1:${server.address().port}/agents/${id}`, taskIdScheme: 'messageId' })) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const added = (await request('/nodes/connect', { url: `http://127.0.0.1:${server.address().port}`, token })).body;
  withdrawn = true;
  const checked = (await request(`/nodes/${added.node.id}/check`, {})).body;
  assert.equal(checked.agents.length, 2);
  const missing = checked.agents.find(a => a.id === 'claude');
  assert.equal(missing.availability, 'withdrawn');
  assert.equal((await request(`/connections/${missing.connectionId}`, undefined, 'DELETE')).status, 200);
  assert.equal(app.store.list('connection').length, 1);
});
