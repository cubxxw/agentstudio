import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messagesForRun } from './runtime.mjs';

test('a queued follow-up includes a late predecessor answer but excludes future questions', () => {
  const first = { id: 'r1', messageId: 'm1', status: 'completed' };
  const second = { id: 'r2', messageId: 'm2', status: 'running' };
  const thread = { runs: [first, second], messages: [
    { id: 'm1', role: 'user', text: 'first' },
    { id: 'm2', role: 'user', text: 'second' },
    { id: 'm3', role: 'user', text: 'future' },
    { id: 'a1', role: 'assistant', text: 'first answer', runId: 'r1' },
  ] };
  assert.deepEqual(messagesForRun(thread, second).map(m => m.id), ['m1', 'a1', 'm2']);
});

test('causal reply ordering still enforces recipient and join boundaries', () => {
  const run = { id: 'r2', messageId: 'm2', contactId: 'newcomer', visibleAfterMessageId: 'm1' };
  const thread = { runs: [{ id: 'r1', messageId: 'm1' }, run], messages: [
    { id: 'm1', role: 'user', text: 'before joining' },
    { id: 'm2', role: 'user', text: 'after joining' },
    { id: 'a1', role: 'assistant', text: 'private late reply', runId: 'r1', recipientIds: ['original'] },
  ] };
  assert.deepEqual(messagesForRun(thread, run).map(m => m.id), ['m2']);
});

test('the entire new group audience must be authorized for historical replies and attachments', () => {
  const run = { id: 'r2', messageId: 'm2', contactId: 'agent_codex' }, thread = { kind: 'group', memberIds: ['self', 'agent_codex', 'agent_pi', 'newcomer'], runs: [{ id: 'r1', messageId: 'm1' }, run], messages: [
    { id: 'm1', role: 'user', text: 'PRIVATE_OLD_ATTACHMENT', recipientIds: ['self', 'agent_codex', 'agent_pi'] },
    { id: 'a1', role: 'assistant', runId: 'r1', text: 'PRIVATE_OLD_REPLY', recipientIds: ['self', 'agent_codex', 'agent_pi'] },
    { id: 'm2', role: 'user', text: 'Current request', recipientIds: ['self', 'agent_codex', 'agent_pi', 'newcomer'] },
  ] };
  assert.deepEqual(messagesForRun(thread, run).map(message => message.id), ['m2']);
});
