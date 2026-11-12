import test from 'node:test';
import assert from 'node:assert/strict';
import { isTailnetIP, deviceOrigin } from './device-network.mjs';

test('device addresses accept only tailnet origins and local test loopback, with no secret-bearing URL fields', () => {
  for (const value of ['100.64.0.1', '100.127.255.254']) assert.equal(isTailnetIP(value), true);
  for (const value of ['100.63.255.255', '100.128.0.1', '100.064.0.1', '100.64.0.256', '127.0.0.1', '100.64.0.1.example']) assert.equal(isTailnetIP(value), false);
  assert.equal(deviceOrigin('http://100.64.0.1:18750'), 'http://100.64.0.1:18750');
  assert.equal(deviceOrigin('https://mini.example.ts.net'), 'https://mini.example.ts.net');
  for (const value of ['http://192.168.1.1', 'https://unrelated.example', 'http://user:pass@100.64.0.1', 'http://100.64.0.1/api', 'http://100.64.0.1?token=private', 'http://100.64.0.1#private']) assert.throws(() => deviceOrigin(value));
});
