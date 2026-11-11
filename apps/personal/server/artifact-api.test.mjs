import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createPersonalServer } from './index.mjs';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'artifact-api-')), events = new EventEmitter(); let n = 0;
  const profile = { agentId: 'codex', defaults: { provider: 'synthetic', model: 'test', thinking: 'off' }, providers: ['synthetic'], models: [], thinkingLevels: ['off'], version: 'fixture' };
  const app = await createPersonalServer({ dataDir: directory, port: 0,
    discoverLocalAgents: async () => ({ agents: [{ id: 'codex', name: 'Codex', installed: true, auth: { status: 'configured' }, execution: { supported: true }, profile }] }),
    executeLocalAgent: async input => {
      const call = async (name, args = {}) => {
        const response = await fetch(input.toolSession.endpoint, { method: 'POST', headers: { authorization: `Bearer ${input.toolSession.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, arguments: args, callId: `api-tool-${++n}` }) });
        const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value.result;
      };
      if (input.toolSession.toolNames.includes('creation_propose')) {
        await call('creation_propose', { title: 'API website', kind: 'website', goal: 'Make one real immutable page', task: 'Create the page', writePaths: ['index.html'] });
        return { markdown: JSON.stringify({ action: 'reply', text: '建议做一个清晰的页面。' }), identity: { id: 'codex' } };
      }
      await call('artifact_read'); await call('artifact_write', { path: 'index.html', text: '<!doctype html><h1>Verified page</h1>', expectedHash: null });
      await call('artifact_submit', { summary: 'Page' }); await call('task_complete', { summary: 'Done' });
      return { markdown: 'Done', identity: { id: 'codex' } };
    }, onChange: () => events.emit('change') });
  await app.listen();
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const api = async (path, body) => { const res = await fetch(`http://127.0.0.1:${app.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  const wait = predicate => new Promise((resolve, reject) => { const check = () => { if (!predicate()) return; clearTimeout(timer); events.off('change', check); resolve(); }; const timer = setTimeout(() => { events.off('change', check); reject(new Error('State did not arrive')); }, 6000); events.on('change', check); check(); });
  await api('/contacts'); const chat = (await api('/chats', { kind: 'group', title: 'API group', memberIds: ['agent_codex'], clientId: 'api-create-chat' })).body;
  await api(`/threads/${chat.id}/messages`, { text: '做一个静态网页', clientId: 'api-create-message' });
  await wait(() => app.store.require('thread', chat.id).runs.every(run => run.status === 'completed'));
  return { app, api, wait, chat };
}

test('owner routes approve one plan, expose checked immutable preview and preserve legacy artifacts', async t => {
  const f = await fixture(t);
  const state = await f.api(`/threads/${f.chat.id}/creation`); assert.equal(state.status, 200);
  const proposal = state.body.proposals[0]; assert.equal(proposal.state, 'ready');
  assert.ok((await f.api('/workspace/status')).body.blockingRuns > 0, 'pending plan blocks profile switching');
  const approved = await f.api(`/creation-proposals/${proposal.id}/decision`, { choice: 'approve', version: proposal.version, clientId: 'api-owner-approval' }); assert.equal(approved.status, 200);
  await f.wait(() => f.app.store.list('collaboration')[0]?.status === 'waiting_preview');
  const waiting = f.app.store.list('collaboration')[0]; f.app.creation.runtime.recordPreviewCheck(waiting.id, waiting.finalRevisionId, { passed: true, errors: [], viewports: [{ width: 390 }] });
  const library = await f.api('/library/artifacts'); assert.equal(library.body.artifacts.length, 1);
  const artifact = library.body.artifacts[0], detail = await f.api(`/library/artifacts/${artifact.id}`); assert.equal(detail.body.revisions.length, 2);
  const preview = await f.api(`/library/artifacts/${artifact.id}/preview`, { revisionId: artifact.headRevisionId }); assert.equal(preview.status, 200);
  const metadata = await f.api(`/library/previews/${preview.body.id}`), entry = metadata.body.files.find(file => file.path === 'index.html');
  const bytes = await f.api(`/library/previews/${preview.body.id}/files/${entry.id}`); assert.match(bytes.body.text, /Verified page/); assert.equal(bytes.body.mime, 'text/html');
  assert.equal((await f.api(`/library/previews/${preview.body.id}/files/not-a-real-file`)).status, 404);
  assert.equal((await f.api(`/library/artifacts/${artifact.id}/files`, { revisionId: artifact.headRevisionId, path: '../../secrets' })).status, 400);
  const old = f.app.store.require('thread', f.chat.id).artifacts[0]; assert.equal((await f.api(`/artifacts/${old.id}`)).status, 200);
  assert.equal((await f.api('/workspace/status')).body.blockingRuns, 0);
});

test('generic thread retry cannot bypass the collaboration state machine', async t => {
  const f = await fixture(t), proposal = f.app.store.list('creation_proposal')[0];
  await f.api(`/creation-proposals/${proposal.id}/decision`, { choice: 'approve', version: proposal.version, clientId: 'api-approve-control' });
  await f.wait(() => f.app.store.list('collaboration')[0]?.status === 'waiting_preview');
  const waiting = f.app.store.list('collaboration')[0]; f.app.creation.runtime.recordPreviewCheck(waiting.id, waiting.finalRevisionId, { passed: true, errors: [], viewports: [{ width: 390 }] });
  const run = f.app.store.require('thread', f.chat.id).runs.find(item => item.collaboration);
  assert.equal((await f.api(`/threads/${f.chat.id}/retry`, { runId: run.id, clientId: 'unsafe-generic-retry' })).status, 409);
});

test('owner file edits and acceptance are durable through their real fixed API routes', async t => {
  const f = await fixture(t), proposal = f.app.store.list('creation_proposal')[0];
  await f.api(`/creation-proposals/${proposal.id}/decision`, { choice: 'approve', version: proposal.version, clientId: 'approve-human-edit-api' });
  await f.wait(() => f.app.store.list('collaboration')[0]?.status === 'waiting_preview');
  const work = f.app.store.list('collaboration')[0]; f.app.creation.runtime.recordPreviewCheck(work.id, work.finalRevisionId, { passed: true, errors: [], viewports: [{ width: 390 }] });
  const artifact = f.app.store.require('workspace_artifact', work.artifactId), source = (await f.api(`/library/artifacts/${artifact.id}/files`, { revisionId: artifact.headRevisionId, path: 'index.html' })).body.files[0];
  const body = { action: 'edit', expectedVersion: artifact.version, path: 'index.html', expectedHash: source.sha256, text: '<!doctype html><h1>Human contribution</h1>', clientId: 'human-file-edit-via-api' };
  const edited = await f.api(`/library/artifacts/${artifact.id}/change`, body); assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const replay = await f.api(`/library/artifacts/${artifact.id}/change`, body); assert.equal(replay.body.headRevisionId, edited.body.headRevisionId);
  const accepted = await f.api(`/library/artifacts/${artifact.id}/change`, { action: 'accept', expectedVersion: edited.body.version, revisionId: edited.body.headRevisionId, clientId: 'accept-human-file-edit' });
  assert.equal(accepted.body.acceptedRevisionId, edited.body.headRevisionId);
});
