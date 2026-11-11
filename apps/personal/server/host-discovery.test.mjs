import assert from 'node:assert/strict';
import test from 'node:test';
import { collectHostDiscovery } from './host-discovery.mjs';

const now = () => Date.parse('2026-11-11T02:00:00.000Z');
const host = { platform: () => 'darwin', arch: () => 'arm64', totalmem: () => 16 * 1024 ** 3,
  freemem: () => 2.7 * 1024 ** 3, availableParallelism: () => 10, hostname: () => 'PRIVATE_HOST',
  processes: ['PRIVATE_COMMAND'], home: '/Users/PRIVATE_HOME' };
const agent = (id = 'codex', fields = {}) => ({ id, name: id === 'codex' ? 'Codex' : 'Pi', installed: true,
  auth: { status: 'configured' }, execution: { supported: true }, version: '1.2.3', ...fields });
const contact = (id, binding, fields = {}) => ({ id, kind: 'agent', name: id, handle: id, color: 'blue',
  availability: 'ready', binding, ...fields });
const localContact = (id = 'codex', fields = {}) => contact(`agent_${id}`, { type: 'local', localAgentId: id }, fields);
const discover = (fields = {}) => collectHostDiscovery({ now, host, contacts: [], integrations: [],
  localAgents: { checkedAt: '2026-11-11T01:59:00.000Z', agents: [] }, ...fields });

test('discovery contains only real installed assistants and existing ready chat contacts', () => {
  const codex = localContact('codex', { name: '我的研究伙伴' });
  const result = discover({ contacts: [codex, localContact('pi'), localContact('claude'), { id: 'self', kind: 'human' }],
    localAgents: { checkedAt: '2026-11-11T01:59:00.000Z', agents: [agent(), agent('pi', { installed: false }), agent('claude', { auth: { status: 'required' } })] } });
  assert.deepEqual(result.agents.map(item => item.id), ['codex', 'claude']);
  assert.deepEqual(result.readyContacts.map(item => item.contactId), [codex.id]);
  assert.equal(result.readyContacts[0].name, '我的研究伙伴');
  assert.deepEqual(result.recommendations.map(item => item.kind), ['open_contact', 'prepare_roles']);
  assert.equal(result.canPrepareRoles, true);
  assert.equal(codex.name, '我的研究伙伴');
});

test('raw MCP tools are excluded from chat suggestions even when their metadata claims a persona', () => {
  const result = discover({ contacts: [contact('tool', { type: 'connection', connectionId: 'mcp' })],
    integrations: [{ id: 'mcp', type: 'mcp', name: 'All-powerful assistant', capabilities: { chat: true, conversationIsolation: 'per_thread' },
      token: 'PRIVATE_TOKEN', url: 'https://PRIVATE_ENDPOINT/mcp', tools: [{ name: 'PRIVATE_TOOL' }] }] });
  assert.deepEqual(result.readyContacts, []);
  assert.equal(result.excludedToolsCount, 1);
  assert.deepEqual(result.recommendations.map(item => item.kind), ['connect']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test('removed, disconnected, signed-out and unchecked connections are not promoted to ready', () => {
  const contacts = ['removed', 'offline', 'signedout', 'unchecked'].map(id => contact(id, { type: 'connection', connectionId: id }));
  const result = discover({ contacts, integrations: [
    { id: 'offline', type: 'a2a', status: 'disconnected', checkedAt: '2026-11-11T01:00:00Z' },
    { id: 'signedout', type: 'a2a', status: 'needs_login', checkedAt: '2026-11-11T01:00:00Z' },
    { id: 'unchecked', type: 'a2a' },
  ] });
  assert.deepEqual(result.readyContacts, []);
  assert.equal(result.canPrepareRoles, false);
});

test('saved native A2A connections without a check timestamp remain visible without a ready claim', () => {
  const result = discover({ contacts: [contact('existing_muse', { type: 'connection', connectionId: 'muse' }),
    contact('duplicate_muse', { type: 'connection', connectionId: 'muse' })],
    integrations: [{ id: 'muse', name: 'Muse', type: 'a2a', createdAt: '2026-11-11T01:00:00Z',
      token: 'PRIVATE_TOKEN', url: 'http://PRIVATE_ENDPOINT/native/instance', capabilities: { conversationIsolation: 'per_thread' } }] });
  assert.deepEqual(result.readyContacts, []);
  assert.equal(result.configuredContacts.length, 1);
  assert.equal(result.configuredContacts[0].contactId, 'existing_muse');
  assert.equal(result.configuredContacts[0].source, 'existing_connection');
  assert.equal(result.configuredContacts[0].statusLabel, '已保存连接，发送时核对');
  assert.deepEqual(result.configuredContacts[0].capabilities, { chat: true, incrementalReply: 'unknown', stop: 'unknown', conversationIsolation: 'unknown' });
  assert.equal(result.recommendations[0].kind, 'open_contact');
  assert.equal(result.recommendations[0].contactId, 'existing_muse');
  assert.match(result.recommendations[0].reason, /发送时核对/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|per_thread|已断开|登录失败/);
});

test('known disconnected, signed-out or failed records do not appear as configured chat suggestions', () => {
  const ids = ['disconnected', 'needs_login', 'error'];
  const result = discover({ contacts: ids.map(id => contact(id, { type: 'connection', connectionId: id })),
    integrations: ids.map(id => ({ id, type: 'a2a', createdAt: '2026-11-11T01:00:00Z', status: id })) });
  assert.deepEqual(result.readyContacts, []);
  assert.deepEqual(result.configuredContacts, []);
  assert.deepEqual(result.recommendations.map(item => item.kind), ['connect']);
});

test('saved existing service chats remain among initial recommendations when local roles are available', () => {
  const result = discover({ contacts: [localContact(), localContact('pi'), contact('muse', { type: 'connection', connectionId: 'muse' })],
    localAgents: { checkedAt: '2026-11-11T01:00:00Z', agents: [agent(), agent('pi')] },
    integrations: [{ id: 'muse', name: 'Muse', type: 'a2a', createdAt: '2026-11-11T01:00:00Z' }] });
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.recommendations[0].contactId, 'muse');
  assert.equal(result.recommendations[2].kind, 'prepare_roles');
});

test('connected A2A suggestions reuse one existing contact without trusting advertised capability claims', () => {
  const connection = { id: 'muse', name: 'Muse', type: 'a2a', status: 'checked', checkedAt: '2026-11-11T01:00:00Z',
    capabilities: { chat: true, streaming: true, stop: true, conversationIsolation: 'per_thread' }, token: 'PRIVATE_TOKEN', url: 'https://PRIVATE_ENDPOINT/rpc' };
  const result = discover({ contacts: [contact('existing_muse', { type: 'connection', connectionId: 'muse' }),
    contact('duplicate_muse', { type: 'connection', connectionId: 'muse' })], integrations: [connection] });
  assert.equal(result.readyContacts.length, 1);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].kind, 'open_contact');
  assert.equal(result.recommendations[0].contactId, 'existing_muse');
  assert.deepEqual(result.readyContacts[0].capabilities, { chat: true, incrementalReply: 'unknown', stop: 'unknown', conversationIsolation: 'unknown' });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|per_thread/);
});

test('a failed contact configuration or incomplete discovery cannot look ready', () => {
  const result = discover({ contacts: [localContact(), localContact('pi', { availability: 'configuration_required' })],
    localAgents: { agents: [agent(), agent('pi')] } });
  assert.deepEqual(result.readyContacts, []);
  assert.equal(result.localAgentsCheckedAt, null);
  assert.equal(result.canPrepareRoles, false);
  const configured = discover({ contacts: [localContact('pi', { configurationError: 'Choose a model' })],
    localAgents: { checkedAt: '2026-11-11T01:00:00Z', agents: [agent('pi')] } });
  assert.deepEqual(configured.readyContacts, []);
  assert.equal(configured.canPrepareRoles, true);
});

test('at most three rules-based suggestions prioritize real existing chats and reuse role onboarding', () => {
  const result = discover({ contacts: [localContact(), localContact('pi'), contact('muse', { type: 'connection', connectionId: 'muse' })],
    localAgents: { checkedAt: '2026-11-11T01:00:00Z', agents: [agent(), agent('pi')] },
    integrations: [{ id: 'muse', type: 'a2a', checkedAt: '2026-11-11T01:00:00Z' }] });
  assert.equal(result.readyContacts.length, 3);
  assert.equal(result.recommendations.length, 3);
  assert.deepEqual(result.recommendations.map(item => item.kind), ['open_contact', 'open_contact', 'prepare_roles']);
  assert.equal(result.recommendations[2].source, 'existing_role_onboarding');
});

test('host facts are coarse and never infer macOS memory pressure, disk or queue health', () => {
  const result = discover();
  assert.equal(result.sampledAt, '2026-11-11T02:00:00.000Z');
  assert.deepEqual(result.host, { source: 'node:os', platform: 'darwin', architecture: 'arm64', totalMemoryGiB: 16,
    freeMemoryGiB: 2, cpuCount: 10, memoryPressure: 'unknown', diskAvailableGiB: null, queueDepth: null });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|pressure.*normal|healthy/);
});

test('unsampled, failing or malformed host metrics remain unknown', () => {
  const unsampled = discover({ host: null });
  assert.deepEqual(unsampled.host, { source: 'unavailable', platform: 'unknown', architecture: 'unknown',
    totalMemoryGiB: null, freeMemoryGiB: null, cpuCount: null, memoryPressure: 'unknown', diskAvailableGiB: null, queueDepth: null });
  const result = discover({ host: { platform: () => 'PRIVATE_PLATFORM', arch: () => 'PRIVATE_ARCH',
    totalmem: () => { throw new Error('PRIVATE_FAILURE'); }, freemem: () => NaN, availableParallelism: () => -1 } });
  assert.equal(result.host.totalMemoryGiB, null);
  assert.equal(result.host.cpuCount, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});
