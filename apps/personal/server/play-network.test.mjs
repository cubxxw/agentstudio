import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PlayNetwork } from './play-network.mjs';

test('network publishes only a validated HTTPS tunnel and cleans up its own child', async () => {
  const rooms = { server: { address: () => ({ port: 12345 }) }, listen: async () => {} };
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let starts = 0, kills = 0;
  child.kill = () => { kills++; child.emit('exit', 0); return true; };
  const network = new PlayNetwork(rooms, { spawn: (_command, args) => { starts++; assert.ok(args.includes('http://127.0.0.1:12345')); queueMicrotask(() => { child.stderr.write('https://attacker.example\n'); child.stderr.write('https://synthetic-friend.trycloudflare.com\n'); }); return child; } });
  assert.equal(network.status().state, 'off');
  await Promise.all([network.start(), network.start()]);
  assert.equal(starts, 1); assert.equal(network.status().url, 'https://synthetic-friend.trycloudflare.com');
  assert.equal(rooms.publicOrigin, network.status().url);
  await network.stop(); assert.equal(kills, 1); assert.equal(network.status().state, 'off'); assert.equal(rooms.publicOrigin, null);
});
test('unexpected tunnel exit removes public availability instead of claiming the link still works', async () => {
  const rooms = { server: { address: () => ({ port: 23456 }) }, listen: async () => {} };
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.emit('exit'); return true; };
  const network = new PlayNetwork(rooms, { spawn: () => { queueMicrotask(() => child.stderr.write('https://synthetic-friend.trycloudflare.com\n')); return child; } });
  await network.start(); child.emit('exit', 1);
  assert.equal(network.status().state, 'failed'); assert.equal(rooms.publicOrigin, null); await network.stop();
});
test('stop during listener startup cannot later publish a tunnel', async () => {
  let ready, starts = 0;
  const rooms = { server: { address: () => ({ port: 34567 }) }, listen: () => new Promise(resolve => ready = resolve) };
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.emit('exit'); return true; };
  const network = new PlayNetwork(rooms, { spawn: () => { starts++; queueMicrotask(() => child.stderr.write('https://synthetic-friend.trycloudflare.com\n')); return child; } });
  const pending = network.start(); await network.stop(); ready(); await pending;
  try { assert.equal(starts, 0); assert.equal(network.status().state, 'off'); } finally { await network.stop(); }
});
