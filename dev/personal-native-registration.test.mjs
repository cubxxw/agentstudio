// Run the real main-process handlers with synthetic IPC/backend dependencies.
// No Electron import, sockets, CLI, provider login or account data is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

function sourceBetween(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Update native test source anchors: ${start}`);
  assert.equal(source.indexOf(start, first + start.length), -1, `Ambiguous source anchor: ${start}`);
  return source.slice(first, last);
}

const main = await readFile(new URL('../apps/desktop/src/main/index.ts', import.meta.url), 'utf8');
const contract = await readFile(new URL('../apps/desktop/src/shared/personal-api.ts', import.meta.url), 'utf8');
// Preserve the production function bodies and their private registration state.
// Explicit anchors fail visibly if a refactor moves the handlers elsewhere.
const compiled = stripTypeScriptTypes([
  sourceBetween(contract, 'export const PERSONAL_IPC', '\nconst opaqueId').replace('export const', 'const'),
  sourceBetween(contract, 'export function readNativeIntegration(', '\n/** Fixed local API').replace('export function', 'function'),
  sourceBetween(main, 'const nativeConnections', '\nlet shutdownPromise'),
  sourceBetween(main, 'function registerPersonalIpc()', '\nfunction sendPersonalCommand('),
].join('\n'), { mode: 'strip' });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(outcomes = ['success'], service = 'cue') {
  const handlers = new Map(), connections = new Map(), receipts = new Map();
  const postBodies = [], deletes = [], nativeSources = [], postStarted = deferred(), releasePost = deferred();
  const instance = {
    instanceId: 'synthetic_instance', name: 'Synthetic Agent', service,
    url: 'http://127.0.0.1:19455/a2a/synthetic_instance', token: 'synthetic_local_bridge_token',
  };
  let present = true, state = 'ready', providerLogins = 0, providerSends = 0;
  const context = vm.createContext({
    ipcMain: { on() {}, handle: (name, callback) => handlers.set(name, callback) },
    fromPersonal: () => !context.quitting,
    personalStartup: Promise.resolve(), personalStartupFailed: false, quitting: false, switchingWorkspace: false, nativeOperations: 0,
    createHash, localLogin: {}, mainWindow: { webContents: { send() {} } },
    personalServices: {
      list: async () => present ? [{ id: instance.instanceId, service: 'cue', name: instance.name, status: 'ready', canOpen: false }] : [],
      services: () => [],
      registrations: async () => present ? [instance] : [],
      progress: async () => state === 'ready' ? { state: 'ready', instances: [instance] } : { state },
      publicProgress: async () => ({ state }),
      begin: async () => { providerLogins++; return 'synthetic_flow'; },
      sendDirect: async () => { providerSends++; throw new Error('Provider sends are outside this fixture'); },
      cancel: async () => { state = 'cancelled'; },
      remove: async id => { assert.equal(id, instance.instanceId); present = false; },
    },
    personalHost: { registerNativeSource: async source => { nativeSources.push(source); }, request: async request => {
      if (request.method === 'POST') {
        assert.equal(request.path, '/api/connections');
        const body = JSON.stringify(request.body), key = request.body.clientId;
        postBodies.push(body);
        let receipt = receipts.get(key);
        if (receipt && receipt.body !== body) return { status: 409, body: { error: { code: 'idempotency_conflict' } } };
        if (!receipt) {
          receipt = { body, id: `synthetic_connection_${receipts.size + 1}` };
          receipts.set(key, receipt); connections.set(receipt.id, { ...request.body });
        }
        const outcome = outcomes.shift() || 'success';
        postStarted.resolve();
        // Both failure modes happen after the local backend accepted the POST.
        if (outcome === 'unknown') return { status: 503, body: { error: { code: 'native_unavailable', message: 'Synthetic accepted POST response lost' } } };
        if (outcome === 'wait') await releasePost.promise;
        return { status: 201, body: { id: receipt.id } };
      }
      assert.equal(request.method, 'DELETE');
      deletes.push(request.path);
      const existed = connections.delete(request.path.split('/').at(-1));
      return { status: existed ? 200 : 404, body: { ok: existed } };
    } },
  });
  vm.runInContext(`${compiled}\nregisterPersonalIpc();`, context);
  const channel = vm.runInContext('PERSONAL_IPC.integration', context);
  return {
    context, instance, connections, receipts, postBodies, deletes, nativeSources,
    invoke: action => handlers.get(channel)({}, action),
    postStarted: postStarted.promise, releasePost: releasePost.resolve,
    present: () => present, providerLogins: () => providerLogins, providerSends: () => providerSends,
  };
}

test('native reconnect rejects unknown IDs without registering anything', async () => {
  const f = fixture();
  assert.equal((await f.invoke({ kind: 'reconnect', instanceId: 'unknown_instance' })).state, 'failed');
  assert.equal(f.postBodies.length, 0);
  assert.equal(f.providerLogins(), 0);
  assert.equal(f.providerSends(), 0);
});

test('native reconnect restores an owned receipt without another provider login or send', async () => {
  const f = fixture(['unknown', 'success']);
  assert.equal((await f.invoke({ kind: 'progress', flowId: 'synthetic_flow' })).state, 'failed');
  const reply = await f.invoke({ kind: 'reconnect', instanceId: f.instance.instanceId });
  assert.equal(reply.state, 'ready');
  assert.equal(reply.connectionIds[0], 'synthetic_connection_1');
  assert.equal(f.postBodies.length, 2);
  assert.equal(f.postBodies[0], f.postBodies[1]);
  assert.equal(f.receipts.size, 1);
  assert.equal(f.connections.size, 1);
  assert.equal(f.providerLogins(), 0);
  assert.equal(f.providerSends(), 0);
  assert.ok(!JSON.stringify(reply).includes(f.instance.token));
  assert.ok(!JSON.stringify(reply).includes(f.instance.url));
});

test('native reconnect contract accepts only the owned instance ID', async () => {
  const f = fixture();
  for (const extra of [{ url: 'https://example.invalid/' }, { token: 'synthetic' }, { command: 'anything' }, { headers: {} }, { agentId: 'codex' }]) {
    await assert.rejects(() => f.invoke({ kind: 'reconnect', instanceId: f.instance.instanceId, ...extra }), /Unsupported native action field/);
  }
  await assert.rejects(() => f.invoke({ kind: 'reconnect', instanceId: '../../another-profile' }), /Invalid native action parameter/);
  assert.equal(f.postBodies.length, 0);
});

test('native removal recovers the original unknown POST receipt before deleting', async () => {
  const f = fixture(['unknown', 'success']);
  assert.equal((await f.invoke({ kind: 'progress', flowId: 'synthetic_flow' })).state, 'failed');
  assert.equal(f.connections.size, 1);
  assert.equal((await f.invoke({ kind: 'remove', instanceId: f.instance.instanceId })).state, 'ready');
  assert.equal(f.present(), false);
  assert.equal(f.connections.size, 0);
  assert.equal(f.deletes.length, 1);
  assert.equal(f.postBodies.length, 2);
  assert.equal(f.postBodies[0], f.postBodies[1]);
  assert.equal(f.receipts.size, 1);
});

test('native removal keeps the instance while receipt recovery remains unknown', async () => {
  const f = fixture(['unknown', 'unknown', 'success']);
  assert.equal((await f.invoke({ kind: 'progress', flowId: 'synthetic_flow' })).state, 'failed');
  assert.equal((await f.invoke({ kind: 'remove', instanceId: f.instance.instanceId })).state, 'failed');
  assert.equal(f.present(), true);
  assert.equal(f.connections.size, 1);
  assert.equal(f.deletes.length, 0);
  assert.equal(f.postBodies.length, 2);
  assert.equal((await f.invoke({ kind: 'remove', instanceId: f.instance.instanceId })).state, 'ready');
  assert.equal(f.present(), false);
  assert.equal(f.connections.size, 0);
  assert.equal(f.deletes.length, 1);
  assert.equal(f.postBodies.length, 3);
  assert.ok(f.postBodies.every(body => body === f.postBodies[0]));
  assert.equal(f.receipts.size, 1);
});

test('native removal waits for a pending registration and prevents late ready', { timeout: 1000 }, async () => {
  const f = fixture(['wait']);
  const progress = f.invoke({ kind: 'progress', flowId: 'synthetic_flow' });
  await f.postStarted;
  const removal = f.invoke({ kind: 'remove', instanceId: f.instance.instanceId });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('nativeRemovals.has("synthetic_instance")', f.context), true);
  f.releasePost();
  assert.equal((await removal).state, 'ready');
  assert.equal((await progress).state, 'failed');
  assert.equal(f.present(), false);
  assert.equal(f.connections.size, 0);
  assert.equal(f.deletes.length, 1);
});

test('native concurrent registration shares one POST and receipt', { timeout: 1000 }, async () => {
  const f = fixture(['wait']);
  const first = f.invoke({ kind: 'progress', flowId: 'synthetic_flow' });
  await f.postStarted;
  const second = f.invoke({ kind: 'progress', flowId: 'synthetic_flow' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.postBodies.length, 1);
  f.releasePost();
  const replies = await Promise.all([first, second]);
  assert.equal(replies[0].connectionIds[0], replies[1].connectionIds[0]);
});

test('native cancel after provider readiness reports the already completed connection consistently', { timeout: 1000 }, async () => {
  const f = fixture(['wait']);
  const progress = f.invoke({ kind: 'progress', flowId: 'synthetic_flow' });
  await f.postStarted;
  const cancellation = f.invoke({ kind: 'cancel', flowId: 'synthetic_flow' });
  await new Promise(resolve => setImmediate(resolve));
  f.releasePost();
  assert.equal((await cancellation).state, 'ready');
  assert.equal((await progress).state, 'ready');
  assert.equal(f.postBodies.length, 1);
});

test('native quit during startup rejects a late local login', async () => {
  const f = fixture(), startup = deferred();
  let begins = 0;
  f.context.personalStartup = startup.promise;
  f.context.localLogin = { begin: () => { begins++; return { state: 'waiting' }; } };
  const pending = f.invoke({ kind: 'local-login', agentId: 'codex' });
  f.context.quitting = true;
  startup.resolve();
  assert.equal((await pending).state, 'failed');
  assert.equal(begins, 0);
});


test('native connection requests cannot start while a workspace switch is reserved', async () => {
  const f = fixture(); f.context.switchingWorkspace = true;
  await assert.rejects(() => f.invoke({kind: 'connect', serviceId: 'cue'}), /forbidden/);
  assert.equal(f.providerLogins(), 0);
  assert.equal(f.postBodies.length, 0);
});

test('Grok native readiness privately registers its source without forwarding credentials',async()=>{
 const f=fixture(['success'],'grokbot');const reply=await f.invoke({kind:'progress',flowId:'synthetic_flow'});
 assert.equal(reply.state,'ready');assert.equal(f.nativeSources.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(f.nativeSources[0])),{connectionId:'synthetic_connection_1',instanceId:f.instance.instanceId,service:'grokbot'});
 assert.equal(JSON.stringify(reply).includes(f.instance.token),false);
});

test('native catalog keeps diagnostics private and includes safe disconnected identities', async () => {
  const f = fixture();
  f.context.personalServices.list = async () => [{ id: f.instance.instanceId, service: 'grokbot', name: 'Synthetic Bot', status: 'error', canOpen: false, message: 'synthetic-private-provider-diagnostic' }];
  f.context.personalServices.snapshot = async () => ({ port: 19455, instances: [], tasks: [] });
  f.context.personalHost.syncNativeServices = async () => [{ id: 'saved_muse', service: 'muse', name: 'Saved Muse', status: 'needs_login', hasCredentials: false, canOpen: false, connectionId: 'saved_connection' }];
  const result = await f.invoke({ kind: 'services' });
  assert.equal(result.state, 'catalog'); assert.equal(result.instances.length, 2);
  assert.equal(result.instances[0].hasCredentials, true);
  assert.equal(result.instances[1].hasCredentials, false);
  assert.ok(!JSON.stringify(result).includes('synthetic-private-provider-diagnostic'));
  assert.ok(!JSON.stringify(result).includes(f.instance.token));
  assert.ok(!JSON.stringify(result).includes(f.instance.url));
});
