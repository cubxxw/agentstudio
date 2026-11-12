// Execute the actual read hook against controlled DOM, RAF and API boundaries.
import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';

const repo = resolve(import.meta.dirname, '..');
const sourcePath = resolve(repo, 'apps/personal/src/use-conversation-read.ts');
const originalSource = readFileSync(sourcePath, 'utf8');
const transform = source => stripTypeScriptTypes(source.replace(/^import .*$/gm, '').replace(/export function /g, 'function '));
const hookSource = transform(originalSource);
const rowSource = transform(readFileSync(resolve(repo, 'apps/personal/src/conversation-rows.ts'), 'utf8'));
const conversationRows = vm.runInNewContext(`${rowSource}\nconversationRows;`);
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ situation = 'visible', deferred = false } = {}) {
  const refs = [], frames = new Map(), calls = [], resolvers = [], rejectors = [], onReadCalls = [];
  let refCursor = 0, frameId = 0, cleanup, previousDependencies;
  const reply = { dataset: { messageId: 'late' }, getBoundingClientRect: () => situation === 'above-viewport' ? { top: -100, bottom: -1 } : { top: 100, bottom: 200 } };
  const node = {
    scrollHeight: 3000, clientHeight: 800, scrollTop: 2200,
    getClientRects: () => [{}], getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
    querySelectorAll: () => situation === 'trimmed' ? [] : [reply],
    addEventListener() {}, removeEventListener() {},
  };
  const timeline = { current: node };
  const onRead = (...args) => onReadCalls.push(args);
  const context = vm.createContext({
    useRef(value) { const index = refCursor++; return refs[index] ?? (refs[index] = { current: value }); },
    useEffect(effect, dependencies) {
      const changed = !previousDependencies || dependencies.some((value, index) => !Object.is(value, previousDependencies[index]));
      if (!changed) return;
      cleanup?.(); previousDependencies = [...dependencies]; cleanup = effect();
    },
    api(...args) {
      calls.push(args);
      return deferred ? new Promise((resolve, reject) => { resolvers.push(resolve); rejectors.push(reject); }) : Promise.resolve({ unreadCount: 0 });
    },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    document: {
      hidden: situation === 'hidden', hasFocus: () => situation !== 'unfocused',
      querySelector: () => situation === 'dialog' ? {} : null,
      addEventListener() {}, removeEventListener() {},
    },
    window: { addEventListener() {}, removeEventListener() {} },
  });
  vm.runInContext(`${hookSource}\nglobalThis.hook = useConversationRead;`, context);
  function flushFrames() {
    let budget = 20;
    while (frames.size) {
      assert.ok(budget-- > 0, 'RAF did not settle');
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback();
    }
  }
  return {
    calls, resolvers, rejectors, onReadCalls, frames,
    setSituation(value) { situation = value; },
    render(thread, visible = true, renderVersion = 0) {
      refCursor = 0;
      reply.dataset.messageId = thread.messages.findLast(message => message.role === 'assistant').id;
      context.hook(thread, visible, timeline, onRead, renderVersion);
      flushFrames();
    },
    flushFrames,
    close() { cleanup?.(); },
  };
}

nodeTest('unread acknowledgments require visible replies and recheck newer snapshots without retry loops', async () => {
// Real conversationRows behavior: an old run's late final answer is grouped next
// to its originating question, outside ConversationTimeline's last 160 rows.
const messages = Array.from({ length: 200 }, (_, index) => ({ id: `u${index}`, role: 'user', createdAt: '2026-11-12T00:00:00Z' }));
messages.push({ id: 'late', role: 'assistant', runId: 'old', text: 'Late invisible reply', createdAt: '2026-11-12T00:00:00Z' });
const thread = { id: 'thr_review', messages, runs: [{ id: 'old', messageId: 'u0', status: 'completed' }] };
const rendered = conversationRows(thread).slice(-160).flatMap(row => row.type === 'message' ? [row.message.id] : row.messages.map(message => message.id));
assert.equal(rendered.includes('late'), false);
const visibilityChecks = [];
for (const situation of ['trimmed', 'above-viewport', 'visible', 'hidden', 'unfocused', 'dialog']) {
  const test = harness({ situation });
  test.render(thread);
  await tick();
  const expected = situation === 'visible' ? 1 : 0;
  assert.equal(test.calls.length, expected, `${situation}: wrong acknowledgment count`);
  visibilityChecks.push({ situation, acknowledgments: test.calls.length });
  test.close();
}

// Expanding history changes rendered rows without changing the thread snapshot.
// Observe dependencies as React does: the renderVersion change must rerun effect.
const expanded = harness({ situation: 'trimmed' });
expanded.render(thread, true, 80);
assert.equal(expanded.calls.length, 0);
expanded.setSituation('visible');
expanded.render(thread, true, 80);
assert.equal(expanded.calls.length, 0, 'unchanged dependencies should not rerun the effect');
expanded.render(thread, true, 160);
await tick();
const expandedHistoryRechecked = expanded.calls.length === 1;
assert.equal(expandedHistoryRechecked, true, 'expanding the rendered rows did not recheck the same snapshot');
expanded.close();

// A failed acknowledgment must wait for an external retry, not create a loop.
const failed = harness({ deferred: true });
failed.render({ id: 'failure', messages: [{ id: 'failure-reply', role: 'assistant' }] });
failed.rejectors.shift()(new Error('Synthetic read failure'));
await tick(); failed.flushFrames(); await tick();
assert.equal(failed.calls.length, 1, 'read failure caused an immediate retry loop');
failed.close();

// Race reproduction: a second visible snapshot arrives before the first read
// response. The old effect is disposed, the new effect sees pending=true. The
// unfixed hook removes pending in finally without rechecking the second snapshot.
const concurrent = harness({ deferred: true });
const snapshot = id => ({ id: 'thread', messages: [{ id, role: 'assistant' }] });
concurrent.render(snapshot('first'));
assert.equal(concurrent.calls.length, 1);
concurrent.render(snapshot('second'));
assert.equal(concurrent.calls.length, 1, 'only one request should be in flight');
concurrent.resolvers.shift()({ unreadCount: 1 });
await tick();
concurrent.flushFrames();
await tick();
const requestMessageIds = concurrent.calls.map(([, body]) => body.messageId);
const automaticallyRetried = requestMessageIds.includes('second');
assert.equal(automaticallyRetried, true, 'newest visible snapshot was never acknowledged after the prior request settled');
concurrent.close();

});
