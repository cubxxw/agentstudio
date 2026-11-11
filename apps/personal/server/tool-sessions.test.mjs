import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ToolSessions } from './tool-sessions.mjs';

const tools = [{ name: 'artifact_probe', description: 'Read the synthetic probe.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }];
async function fixture(t) {
  const broker = new ToolSessions(); await broker.listen(); t.after(() => broker.close());
  const calls = [];
  const session = broker.open({ contactId: 'trusted-codex', runId: 'accepted-run' }, tools, async (context, name, args, callId) => {
    calls.push({ context, name, args, callId }); return { owner: context.contactId, value: 'PROBE_OK' };
  });
  const call = (body, token = session.token, extra = {}) => fetch(session.endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  return { broker, calls, session, call };
}

test('tool broker binds the accepted identity, coalesces a repeated operation, and rejects changed replay', async t => {
  const f = await fixture(t);
  const body = { name: 'artifact_probe', arguments: {}, callId: 'actual-call-1' };
  const a = await f.call(body), b = await f.call(body);
  assert.equal(a.status, 200); assert.deepEqual(await b.json(), await a.json());
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].context.contactId, 'trusted-codex');
  assert.equal((await f.call({ ...body, arguments: { changed: true } })).status, 409);
});

test('unknown tokens, cross-site callers and tools outside the session cannot execute', async t => {
  const f = await fixture(t), body = { name: 'artifact_probe', arguments: {}, callId: 'one' };
  assert.equal((await f.call(body, 'wrong')).status, 401);
  assert.equal((await f.call(body, f.session.token, { origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await f.call({ ...body, name: 'shell' })).status, 403);
  assert.equal(f.calls.length, 0);
  f.session.close(); assert.equal((await f.call(body)).status, 401);
});

test('malformed and oversized tool inputs are rejected before the handler can mutate', async t => {
  const f = await fixture(t);
  assert.equal((await f.call({ name: 'artifact_probe', arguments: [], callId: 'bad-array' })).status, 400);
  const large = await f.call({ name: 'artifact_probe', arguments: { text: 'x'.repeat(2_000_000) }, callId: 'too-large' });
  assert.equal(large.status, 413);
  assert.equal(f.calls.length, 0);
});

test('a cached tool result still requires current policy authorization on replay', async t => {
  const broker = new ToolSessions(); await broker.listen(); t.after(() => broker.close());
  let authorized = true, calls = 0;
  const session = broker.open({ contactId: 'reader' }, tools, async () => { calls++; return { value: 'private result' }; }, {
    validate() { if (!authorized) { const error = new Error('Access revoked'); error.status = 403; error.code = 'grant_revoked'; throw error; } },
  });
  const request = () => fetch(session.endpoint, { method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'artifact_probe', arguments: {}, callId: 'same-read' }) });
  assert.equal((await request()).status, 200); authorized = false;
  assert.equal((await request()).status, 403); assert.equal(calls, 1);
});

test('stdio MCP proxy negotiates, lists only session tools and returns structured real broker results', async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [new URL('./agentroom-tool-proxy.mjs', import.meta.url).pathname], {
    env: { ...process.env, AGENTROOM_TOOL_ENDPOINT: f.session.endpoint, AGENTROOM_TOOL_TOKEN: f.session.token }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const pending = new Map(); let buffer = '', stderr = '';
  child.stderr.on('data', x => { stderr += x; });
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const item = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1);
      pending.get(item.id)?.(item); pending.delete(item.id);
    }
  });
  let n = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++n, timeout = setTimeout(() => reject(new Error(`MCP timeout: ${stderr}`)), 5000);
    pending.set(id, value => { clearTimeout(timeout); resolve(value); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-11-25');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const catalog = await rpc('tools/list', {});
  assert.deepEqual(catalog.result.tools.map(x => x.name), ['artifact_probe']);
  const result = await rpc('tools/call', { name: 'artifact_probe', arguments: {} });
  assert.deepEqual(result.result.structuredContent, { owner: 'trusted-codex', value: 'PROBE_OK' });
  assert.equal(f.calls.length, 1); assert.equal(result.result.isError, false);
  assert.ok(!stderr.includes(f.session.token));
  child.stdin.end();
});
