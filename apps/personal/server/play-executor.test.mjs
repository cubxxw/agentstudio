import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalStore } from './store.mjs';
import { createPlayExecutor } from './play-executor.mjs';

test('guest execution supplies exactly one room read tool and closes its authority after completion', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'play-executor-')); const store = new PersonalStore(dir);
  let accepted, calls = 0, permitted = true;
  const executor = createPlayExecutor(store, { authorize: () => { assert.ok(permitted); }, execute: async input => {
    accepted = input; calls++;
    assert.deepEqual(input.toolSession.toolNames, ['room_read']);
    const headers = { authorization: `Bearer ${input.toolSession.token}`, 'content-type': 'application/json' };
    const good = await fetch(input.toolSession.endpoint, { method: 'POST', headers, body: JSON.stringify({ name: 'room_read', arguments: {}, callId: 'read-accepted' }) });
    assert.equal(good.status, 200); assert.ok(JSON.stringify(await good.json()).includes('PUBLIC_BRIEF'));
    const forbidden = await fetch(input.toolSession.endpoint, { method: 'POST', headers, body: JSON.stringify({ name: 'shell', arguments: {}, callId: 'forbidden' }) });
    assert.equal(forbidden.status, 403);
    return { markdown: '一份共同草稿' };
  } });
  t.after(async () => { await executor.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  store.put('memory', { id: 'private', text: 'PRIVATE_MEMORY' });
  const result = await executor.execute({ title: '项目', brief: 'PUBLIC_BRIEF', persona: 'AI分身', messages: [], board: {} }, new AbortController().signal, { id: 'pj_test', roomId: 'pr_test', backend: 'codex', executionSnapshot: { model: 'accepted-model' } });
  assert.equal(result.markdown, '一份共同草稿'); assert.equal(calls, 1);
  assert.equal(accepted.executionSnapshot.model, 'accepted-model'); assert.ok(!accepted.prompt.includes('PRIVATE_MEMORY'));
  assert.ok(!accepted.prompt.includes(accepted.toolSession.token));
  assert.equal((await fetch(accepted.toolSession.endpoint, { headers: { authorization: `Bearer ${accepted.toolSession.token}` } })).status, 401);
});
