import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentAvatar, defaultAgentAvatar, agentAvatarActivity } from './agent-avatar.mjs';

test('avatar identity uses a stable id and constrains appearance inputs', () => {
  const first = defaultAgentAvatar({ id: 'contact-a', name: '研究员' });
  assert.equal(first.seed, defaultAgentAvatar({ id: 'contact-a', name: 'New name' }).seed);
  assert.notEqual(first.seed, defaultAgentAvatar({ id: 'contact-b', name: '研究员' }).seed);
  const selected = normalizeAgentAvatar({ ...first, seed: 'chosen-42', palette: 'orange', eyes: 'happy', motion: false });
  assert.equal(selected.seed, 'chosen-42'); assert.equal(selected.motion, false);
  for (const bad of [{ ...first, seed: '' }, { ...first, seed: 'x'.repeat(129) }, { ...first, style: 'remote' }, { ...first, version: 2 }, { ...first, eyes: 'bad' }, { ...first, motion: 'yes' }, { ...first, svg: '<svg/>' }, []]) {
    assert.throws(() => normalizeAgentAvatar(bad));
  }
});

test('real runs prioritize attention and pending input without inventing tool progress', () => {
  const run = (status, extra = {}) => ({ id: status, status, ...extra });
  assert.equal(agentAvatarActivity([run('running', { progress: { phase: 'thinking' } })]).state, 'thinking');
  assert.equal(agentAvatarActivity([run('running')]).state, 'working');
  assert.equal(agentAvatarActivity([run('queued')]).state, 'queued');
  assert.equal(agentAvatarActivity([run('running'), run('needs_input')]).state, 'waiting');
  assert.equal(agentAvatarActivity([run('running'), run('unknown', { stopUnconfirmed: true })]).state, 'attention');
  assert.equal(agentAvatarActivity([run('completed', { finishedAt: '2026-11-12T00:00:00Z' })]).completedAt, '2026-11-12T00:00:00Z');
  assert.equal(agentAvatarActivity([run('completed'), run('failed')]).state, 'attention');
  assert.equal(agentAvatarActivity([]).state, 'idle');
});

test('original-service pending cards can request attention without a local run', () => {
  assert.equal(agentAvatarActivity([], [{ state: 'pending' }]).state, 'waiting');
  assert.equal(agentAvatarActivity([], [{ state: 'decided' }]).state, 'idle');
});

test('online device waiting overrides local activity and its running count overrides a local queue', () => {
 const thinking = [{ id: 'r', status: 'running', progress: { phase: 'thinking' } }];
 assert.equal(agentAvatarActivity(thinking, [], { running: 1, waiting: 1 }).state, 'waiting');
 assert.equal(agentAvatarActivity([{ id: 'q', status: 'queued' }], [], { running: 1 }).state, 'working');
 assert.equal(agentAvatarActivity([{ id: 'u', status: 'unknown' }], [], { waiting: 1 }).state, 'attention');
});
