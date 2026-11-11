import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, renameSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStore, APIError, digest } from './store.mjs';
import { ArtifactStore } from './artifact-store.mjs';

const actor = { contactId: 'codex', runId: 'run-codex', approved: true };
const code = wanted => error => error.code === wanted;
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'artifact-store-'));
  let store = new PersonalStore(directory);
  const authorize = context => { if (!context?.approved) throw new APIError(403, 'permission_required', 'Approval required'); };
  let artifacts = new ArtifactStore(store, { authorize });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, get store() { return store; }, get artifacts() { return artifacts; }, restart() { store.close(); store = new PersonalStore(directory); artifacts = new ArtifactStore(store, { authorize }); } };
}
function seed(f, files, kind = 'website') {
  const artifact = f.artifacts.create({ title: '合成阅读官网', kind }, actor);
  const stage = f.artifacts.stage(artifact.id, 'seed', null, actor);
  for (const [path, text] of Object.entries(files)) f.artifacts.write(stage.id, { path, text, expectedHash: null }, actor);
  const contribution = f.artifacts.submit(stage.id, actor);
  return f.artifacts.integrate(contribution.id, actor);
}

test('approval precedes artifact creation and committed revisions survive reopening with verified bytes', t => {
  const f = fixture(t);
  assert.throws(() => f.artifacts.create({ title: 'Forbidden', kind: 'document' }, {}), code('permission_required'));
  assert.ok(!existsSync(join(f.directory, 'artifacts')));
  const result = seed(f, { 'brief.md': 'A reading website', 'index.html': '<!doctype html><html><body>Reading</body></html>' });
  const id = result.artifact.id, revisionId = result.revision.id;
  assert.equal(result.artifact.materializationState, 'clean');
  f.restart();
  const read = f.artifacts.read(id, revisionId, actor);
  assert.equal(read.files.find(file => file.path === 'brief.md').text, 'A reading website');
  assert.equal(f.store.require('workspace_artifact', id).headRevisionId, revisionId);
});

test('staging preserves expected hashes and rejects path traversal or symlink escape', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Original' }, 'document');
  const stage = f.artifacts.stage(base.artifact.id, 'editing', base.revision.id, actor);
  assert.throws(() => f.artifacts.write(stage.id, { path: '../escape', text: 'bad', expectedHash: null }, actor), code('invalid_path'));
  assert.throws(() => f.artifacts.write(stage.id, { path: 'brief.md', text: 'bad', expectedHash: 'wrong' }, actor), code('file_conflict'));
  symlinkSync(f.directory, join(stage.directory, 'outside'));
  assert.throws(() => f.artifacts.write(stage.id, { path: 'outside/private.md', text: 'bad', expectedHash: null }, actor), code('invalid_path'));
  assert.ok(!existsSync(join(f.directory, 'private.md')));
});

test('a changed brief invalidates a disjoint implementation contribution', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Version one', 'app.js': 'old' }, 'document');
  const coding = f.artifacts.stage(base.artifact.id, 'coding', base.revision.id, actor);
  f.artifacts.write(coding.id, { path: 'app.js', text: 'new implementation', expectedHash: digest('old') }, actor);
  const proposed = f.artifacts.submit(coding.id, actor);
  const brief = f.artifacts.stage(base.artifact.id, 'newbrief', base.revision.id, actor);
  f.artifacts.write(brief.id, { path: 'brief.md', text: 'New product direction', expectedHash: digest('Version one') }, actor);
  f.artifacts.integrate(f.artifacts.submit(brief.id, actor).id, actor);
  assert.throws(() => f.artifacts.candidate(proposed.id, actor), code('stale_revision'));
});

test('disjoint valid contributions merge but conflicting file writes never overwrite each other', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Stable brief', 'a.md': 'A' }, 'document');
  const a = f.artifacts.stage(base.artifact.id, 'a', base.revision.id, actor);
  const b = f.artifacts.stage(base.artifact.id, 'b', base.revision.id, actor);
  f.artifacts.write(a.id, { path: 'a.md', text: 'A2', expectedHash: digest('A') }, actor);
  f.artifacts.write(b.id, { path: 'b.md', text: 'B', expectedHash: null }, actor);
  const ca = f.artifacts.submit(a.id, actor), cb = f.artifacts.submit(b.id, actor);
  f.artifacts.integrate(cb.id, actor);
  const result = f.artifacts.integrate(ca.id, actor);
  const files = f.artifacts.read(base.artifact.id, result.revision.id, actor).files;
  assert.equal(files.find(file => file.path === 'a.md').text, 'A2');
  assert.equal(files.find(file => file.path === 'b.md').text, 'B');
  const stale = f.artifacts.stage(base.artifact.id, 'conflicting', base.revision.id, actor);
  f.artifacts.write(stale.id, { path: 'a.md', text: 'Other A', expectedHash: digest('A') }, actor);
  assert.throws(() => f.artifacts.integrate(f.artifacts.submit(stale.id, actor).id, actor), code('file_conflict'));
});

test('checks bind the full candidate and stale checked parents cannot replace a newer head', t => {
  const f = fixture(t), base = seed(f, { 'index.html': '<!doctype html><link rel="stylesheet" href="style.css"><p>Reading</p>', 'style.css': 'p{color:navy}' });
  const stage = f.artifacts.stage(base.artifact.id, 'broken', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'style.css', text: null, expectedHash: digest('p{color:navy}') }, actor);
  const candidate = f.artifacts.candidate(f.artifacts.submit(stage.id, actor).id, actor);
  const checked = f.artifacts.check(candidate.id, actor);
  assert.equal(checked.passed, false); assert.equal(checked.manifestHash, candidate.manifestHash);
  assert.throws(() => f.artifacts.commit(candidate.id, base.revision.id, actor), code('checks_failed'));
  assert.equal(f.store.require('workspace_artifact', base.artifact.id).headRevisionId, base.revision.id);
  const one = f.artifacts.stage(base.artifact.id, 'one', base.revision.id, actor);
  f.artifacts.write(one.id, { path: 'one.md', text: 'one', expectedHash: null }, actor);
  const pending = f.artifacts.candidate(f.artifacts.submit(one.id, actor).id, actor); f.artifacts.check(pending.id, actor);
  const two = f.artifacts.stage(base.artifact.id, 'two', base.revision.id, actor);
  f.artifacts.write(two.id, { path: 'two.md', text: 'two', expectedHash: null }, actor);
  f.artifacts.integrate(f.artifacts.submit(two.id, actor).id, actor);
  assert.throws(() => f.artifacts.commit(pending.id, base.revision.id, actor), code('stale_revision'));
});

test('human current files are retained when a new immutable head is saved', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Original' }, 'document');
  const current = join(f.directory, 'artifacts', base.artifact.id, 'current', 'brief.md');
  writeFileSync(current, 'Human unsaved edits');
  const stage = f.artifacts.stage(base.artifact.id, 'agent-update', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'brief.md', text: 'Agent revision', expectedHash: digest('Original') }, actor);
  const result = f.artifacts.integrate(f.artifacts.submit(stage.id, actor).id, actor);
  assert.equal(result.artifact.materializationState, 'blocked_by_local_changes');
  assert.equal(readFileSync(current, 'utf8'), 'Human unsaved edits');
  assert.equal(f.artifacts.read(base.artifact.id, result.revision.id, actor).files[0].text, 'Agent revision');
  const resolved = f.artifacts.resolveLocal(base.artifact.id, 'preserve-and-update', actor);
  assert.equal(readFileSync(join(resolved.backupPath, 'brief.md'), 'utf8'), 'Human unsaved edits');
  assert.equal(readFileSync(current, 'utf8'), 'Agent revision');
});

test('file map ordering does not misclassify an untouched directory as human edits', t => {
  const f = fixture(t), base = seed(f, { 'Zebra.md': 'upper', 'apple.md': 'lower', '阅读.md': '阅读' }, 'document');
  const stage = f.artifacts.stage(base.artifact.id, 'next', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'next.md', text: 'next', expectedHash: null }, actor);
  const result = f.artifacts.integrate(f.artifacts.submit(stage.id, actor).id, actor);
  assert.equal(result.artifact.materializationState, 'clean');
});

test('restart repairs a committed head after power loss before materialization', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'old' }, 'document');
  const stage = f.artifacts.stage(base.artifact.id, 'after-restart', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'brief.md', text: 'new', expectedHash: digest('old') }, actor);
  const candidate = f.artifacts.candidate(f.artifacts.submit(stage.id, actor).id, actor); f.artifacts.check(candidate.id, actor);
  f.artifacts.materialize = () => { throw new Error('Synthetic power loss after commit'); };
  assert.throws(() => f.artifacts.commit(candidate.id, base.revision.id, actor), /Synthetic power loss/);
  f.restart();
  const artifact = f.store.require('workspace_artifact', base.artifact.id);
  assert.equal(artifact.materializationState, 'clean'); assert.equal(artifact.currentRevisionId, candidate.id);
  assert.equal(readFileSync(join(f.directory, 'artifacts', artifact.id, 'current/brief.md'), 'utf8'), 'new');
});

test('corrupt immutable objects are never returned as verified revision content', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'source' }, 'document');
  writeFileSync(join(f.directory, 'artifacts', base.artifact.id, 'objects/sha256', digest('source')), 'corrupt');
  assert.throws(() => f.artifacts.read(base.artifact.id, base.revision.id, actor), code('artifact_corrupted'));
});

test('restart completes a prepared directory swap without discarding the previous tree', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'old' }, 'document');
  const stage = f.artifacts.stage(base.artifact.id, 'swap', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'brief.md', text: 'new', expectedHash: digest('old') }, actor);
  const revision = f.artifacts.candidate(f.artifacts.submit(stage.id, actor).id, actor); f.artifacts.check(revision.id, actor);
  f.artifacts.materialize = () => { throw new Error('Synthetic power loss'); };
  assert.throws(() => f.artifacts.commit(revision.id, base.revision.id, actor));
  const root = join(f.directory, 'artifacts', base.artifact.id), next = join(root, 'materialize_interrupted_next'), backup = join(root, 'local-backups/materialize_interrupted');
  mkdirSync(next); writeFileSync(join(next, 'brief.md'), 'new'); renameSync(join(root, 'current'), backup);
  f.store.put('artifact_materialization', { id: 'materialize_interrupted', artifactId: base.artifact.id, revisionId: revision.id, previousRevisionId: base.revision.id, state: 'prepared' });
  f.restart();
  assert.equal(readFileSync(join(root, 'current/brief.md'), 'utf8'), 'new');
  assert.equal(readFileSync(join(backup, 'brief.md'), 'utf8'), 'old');
  assert.equal(f.store.require('workspace_artifact', base.artifact.id).currentRevisionId, revision.id);
});

test('a writer reads its staged bytes and current hashes without treating its own changes as stale inputs', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'old' }, 'document');
  const stage = f.artifacts.stage(base.artifact.id, 'read-stage', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'brief.md', text: 'new', expectedHash: digest('old') }, actor);
  const read = f.artifacts.readStage(stage.id, actor, ['brief.md']);
  assert.equal(read.files[0].text, 'new'); assert.equal(read.files[0].sha256, digest('new'));
  const result = f.artifacts.integrate(f.artifacts.submit(stage.id, actor).id, actor);
  assert.equal(result.artifact.materializationState, 'clean');
});

test('integrating the same contribution twice does not create an extra version', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'initial' }, 'document');
  const stage = f.artifacts.stage(base.artifact.id, 'one-submission', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'other.md', text: 'new', expectedHash: null }, actor);
  const contribution = f.artifacts.submit(stage.id, actor);
  const first = f.artifacts.integrate(contribution.id, actor), second = f.artifacts.integrate(contribution.id, actor);
  assert.equal(second.revision.id, first.revision.id);
  assert.equal(second.artifact.headRevisionId, first.revision.id);
});

test('a quarantined contribution remains stored but cannot be integrated', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'initial' }, 'document');
  const stage = f.artifacts.stage(base.artifact.id, 'quarantine', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'other.md', text: 'pending', expectedHash: null }, actor);
  const contribution = f.artifacts.submit(stage.id, actor);
  f.store.put('artifact_contribution', { ...contribution, state: 'quarantined' });
  assert.throws(() => f.artifacts.integrate(contribution.id, actor), code('contribution_quarantined'));
  assert.equal(f.store.require('artifact_contribution', contribution.id).state, 'quarantined');
  assert.equal(f.store.require('workspace_artifact', base.artifact.id).headRevisionId, base.revision.id);
});

test('a newly added brief invalidates work that started before the brief existed', t => {
  const f = fixture(t), base = seed(f, { 'notes.md': 'early idea' }, 'document');
  const codeStage = f.artifacts.stage(base.artifact.id, 'early-code', base.revision.id, actor);
  f.artifacts.write(codeStage.id, { path: 'code.js', text: 'old intent', expectedHash: null }, actor);
  const contribution = f.artifacts.submit(codeStage.id, actor);
  const brief = f.artifacts.stage(base.artifact.id, 'added-brief', base.revision.id, actor);
  f.artifacts.write(brief.id, { path: 'brief.md', text: 'new agreed requirement', expectedHash: null }, actor);
  f.artifacts.integrate(f.artifacts.submit(brief.id, actor).id, actor);
  assert.throws(() => f.artifacts.candidate(contribution.id, actor), code('stale_revision'));
});

test('owner edits, accepts and restores through new attributed versions without rewriting history', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Original' }, 'document'), owner = { ...actor, owner: true, contactId: 'self', runId: 'human-file-edit' };
  const changed = f.artifacts.ownerChange(base.artifact.id, { action: 'edit', expectedVersion: base.artifact.version, path: 'brief.md', text: 'Human change', expectedHash: digest('Original') }, owner);
  const accepted = f.artifacts.ownerChange(base.artifact.id, { action: 'accept', expectedVersion: changed.version, revisionId: changed.headRevisionId }, owner);
  assert.equal(accepted.acceptedRevisionId, changed.headRevisionId);
  const restored = f.artifacts.ownerChange(base.artifact.id, { action: 'restore', expectedVersion: accepted.version, revisionId: base.revision.id }, { ...owner, runId: 'human-restore' });
  assert.notEqual(restored.headRevisionId, base.revision.id); assert.equal(restored.acceptedRevisionId, changed.headRevisionId);
  assert.equal(f.artifacts.read(base.artifact.id, restored.headRevisionId, actor).files[0].text, 'Original');
  assert.equal(f.artifacts.read(base.artifact.id, changed.headRevisionId, actor).files[0].text, 'Human change');
});

test('importing Finder changes records a human contribution and preserves concurrent new-head files', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Original' }, 'document');
  writeFileSync(join(f.directory, 'artifacts', base.artifact.id, 'current', 'brief.md'), 'From Finder');
  const stage = f.artifacts.stage(base.artifact.id, 'new-head', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'new.md', text: 'New head file', expectedHash: null }, actor);
  const head = f.artifacts.integrate(f.artifacts.submit(stage.id, actor).id, actor);
  const imported = f.artifacts.ownerChange(base.artifact.id, { action: 'import-local', expectedVersion: head.artifact.version }, { ...actor, owner: true, contactId: 'self', runId: 'import-finder' });
  const files = f.artifacts.read(base.artifact.id, imported.headRevisionId, actor).files;
  assert.equal(files.find(file => file.path === 'brief.md').text, 'From Finder');
  assert.equal(files.find(file => file.path === 'new.md').text, 'New head file');
  assert.equal(imported.materializationState, 'clean');
});

test('a human edit during materialization preparation keeps current in place and blocks delivery', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Original' }, 'document'), current = join(f.directory, 'artifacts', base.artifact.id, 'current', 'brief.md');
  const put = f.store.put.bind(f.store); let injected = false;
  f.store.put = (kind, value) => { const result = put(kind, value); if (kind === 'artifact_materialization' && value.state === 'prepared' && !injected) { injected = true; writeFileSync(current, 'Concurrent human edit'); } return result; };
  const stage = f.artifacts.stage(base.artifact.id, 'materialize-race', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'new.md', text: 'New content', expectedHash: null }, actor);
  const result = f.artifacts.integrate(f.artifacts.submit(stage.id, actor).id, actor);
  assert.equal(result.artifact.materializationState, 'blocked_by_local_changes');
  assert.equal(readFileSync(current, 'utf8'), 'Concurrent human edit');
});

test('a merged file-directory collision fails before advancing head or marking a contribution integrated', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Stable' }, 'document');
  const a = f.artifacts.stage(base.artifact.id, 'file-assets', base.revision.id, actor), b = f.artifacts.stage(base.artifact.id, 'dir-assets', base.revision.id, actor);
  f.artifacts.write(a.id, { path: 'assets', text: 'A file', expectedHash: null }, actor);
  f.artifacts.write(b.id, { path: 'assets/note.md', text: 'A nested file', expectedHash: null }, actor);
  const ca = f.artifacts.submit(a.id, actor), cb = f.artifacts.submit(b.id, actor), first = f.artifacts.integrate(ca.id, actor);
  assert.throws(() => f.artifacts.integrate(cb.id, actor), code('checks_failed'));
  assert.equal(f.store.require('workspace_artifact', base.artifact.id).headRevisionId, first.revision.id);
  assert.equal(f.store.require('artifact_contribution', cb.id).state, 'submitted');
});

test('same-volume case aliases cannot enter a committed manifest', { skip: process.platform !== 'darwin' }, t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Stable' }, 'document');
  const a = f.artifacts.stage(base.artifact.id, 'case-upper', base.revision.id, actor), b = f.artifacts.stage(base.artifact.id, 'case-lower', base.revision.id, actor);
  f.artifacts.write(a.id, { path: 'Assets', text: 'File', expectedHash: null }, actor);
  f.artifacts.write(b.id, { path: 'assets/note.md', text: 'Nested', expectedHash: null }, actor);
  const cb = f.artifacts.submit(b.id, actor), first = f.artifacts.integrate(f.artifacts.submit(a.id, actor).id, actor);
  assert.throws(() => f.artifacts.integrate(cb.id, actor), code('checks_failed'));
  assert.equal(f.store.require('workspace_artifact', base.artifact.id).headRevisionId, first.revision.id);
});

test('binary Finder files block normal replacement but survive explicit preserve-and-update', t => {
  const f = fixture(t), base = seed(f, { 'brief.md': 'Stable' }, 'document');
  const local = join(f.directory, 'artifacts', base.artifact.id, 'current', '.DS_Store'), bytes = Buffer.from([0, 255, 254, 42]); writeFileSync(local, bytes);
  const stage = f.artifacts.stage(base.artifact.id, 'with-finder-metadata', base.revision.id, actor);
  f.artifacts.write(stage.id, { path: 'new.md', text: 'New', expectedHash: null }, actor);
  const saved = f.artifacts.integrate(f.artifacts.submit(stage.id, actor).id, actor);
  assert.equal(saved.artifact.materializationState, 'blocked_by_local_changes');
  const adopted = f.artifacts.resolveLocal(base.artifact.id, 'preserve-and-update', actor);
  assert.equal(adopted.materializationState, 'clean'); assert.deepEqual(readFileSync(join(adopted.backupPath, '.DS_Store')), bytes);
});
