import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonalStore } from './store.mjs';

for (const partial of [false, true]) test(`existing workspace cards survive indexed-receipt migration (${partial ? 'interrupted' : 'legacy'} schema)`, t => {
  const path = mkdtempSync(join(tmpdir(), 'artifact-index-')); let store;
  t.after(() => { store?.close(); rmSync(path, { recursive: true, force: true }); });
  const db = new DatabaseSync(join(path, 'personal.sqlite'));
  db.exec(`CREATE TABLE documents(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL${partial ? ',thread_id TEXT' : ''},PRIMARY KEY(kind,id));`);
  for (const kind of ['creation_proposal', 'collaboration', 'artifact_link', 'capability_request', 'artifact_tool_operation']) db.prepare('INSERT INTO documents(kind,id,body) VALUES(?,?,?)').run(kind, `old_${kind}`, JSON.stringify({ id: `old_${kind}`, threadId: 'existing_group', name: 'artifact_list', state: 'completed', ok: true }));
  db.close(); store = new PersonalStore(path);
  for (const kind of ['creation_proposal', 'collaboration', 'artifact_link', 'capability_request', 'artifact_tool_receipt']) assert.equal(store.listForThread(kind, 'existing_group').length, 1, `${kind} remains visible after reopening`);
});
