import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonalStore } from './store.mjs';
import { CreationService } from './creation-service.mjs';

test('saved website bytes wait for a trusted native preview verdict before delivery completes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'preview-completion-')), store = new PersonalStore(directory), events = [], service = new CreationService(store, { notify: event => events.push(event) });
  t.after(async () => { await service.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.put('contact', { id: 'agent_codex', binding: { type: 'local', localAgentId: 'codex' } });
  store.put('thread', { id: 'thread', memberIds: ['self', 'agent_codex'], runs: [], messages: [], events: [] });
  store.put('capability_grant', { id: 'grant', threadId: 'thread', state: 'active', expiresAt: Date.now() + 30 * 60000, revokedContacts: [], participants: [{ contactId: 'agent_codex', localAgentId: 'codex' }] });
  // The fixture has genuinely persisted bytes/checks, then the same finalizer as real steps.
  const artifact = service.artifacts.create({ title: 'Preview', kind: 'website' }, { grantId: 'grant', contactId: 'agent_codex' });
  const owner = { owner: true, contactId: 'self', runId: 'seed' }, stage = service.artifacts.stage(artifact.id, 'seed', null, owner);
  service.artifacts.write(stage.id, { path: 'index.html', text: '<!doctype html><h1>Preview</h1>', expectedHash: null }, owner);
  const result = service.artifacts.integrate(service.artifacts.submit(stage.id, owner).id, owner);
  const grant = store.require('capability_grant', 'grant'); Object.assign(grant, { artifactId: artifact.id, baseRevisionId: result.revision.id, producedRevisionIds: [result.revision.id], readPaths: ['**'], extraReads: [] }); store.put('capability_grant', grant);
  store.put('collaboration', { id: 'work', threadId: 'thread', artifactId: artifact.id, grantId: 'grant', audienceIds: ['self', 'agent_codex'], participants: [{ contactId: 'agent_codex' }], status: 'running', steps: [{ id: 'step', status: 'completed' }] });
  service.runtime.enqueueNext('work');
  assert.equal(store.require('collaboration', 'work').status, 'waiting_preview');
  assert.equal(events.at(-1).previewCheck.revisionId, result.revision.id);
  assert.throws(() => service.runtime.recordPreviewCheck('work', 'different_revision', { passed: true, errors: [] }), error => error.code === 'version_conflict');
  service.runtime.recordPreviewCheck('work', result.revision.id, { passed: false, errors: ['Uncaught page error'], viewports: [1280, 390] });
  assert.equal(store.require('collaboration', 'work').status, 'blocked');
  assert.equal(store.require('collaboration', 'work').previewChecks.passed, false);
});
