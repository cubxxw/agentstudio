import { APIError, id, now } from './store.mjs';
import { integrationURL } from './integrations.mjs';
import { validateBearerToken } from './vault.mjs';

function originURL(value) {
  const url = new URL(integrationURL(value));
  if (url.pathname !== '/' || url.protocol === 'https:' && !url.hostname.endsWith('.ts.net')) throw new APIError(400, 'invalid_node_url', '请输入这台服务器的 Tailscale HTTPS 根地址');
  return url.origin;
}
const safeName = value => typeof value === 'string' && value.trim() && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);

async function inspect(origin, headers) {
  let response;
  try { response = await fetch(`${origin}/.well-known/agentroom-node.json`, { headers: { ...headers, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error' }); }
  catch { throw new APIError(502, 'node_unreachable', '暂时连不上这台服务器，请检查 Tailscale 和节点服务'); }
  if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new APIError(401, 'node_unauthorized', '节点没有接受这个令牌，请核对服务器和令牌'); }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new APIError(502, 'invalid_node_manifest', '这个地址没有返回 AgentRoom 节点信息'); }
  let size = 0; const chunks = [];
  try {
    for await (const chunk of response.body) { size += chunk.length; if (size > 128_000) throw new Error(); chunks.push(chunk); }
  } catch { throw new APIError(502, 'invalid_node_manifest', '节点信息不完整或超过大小限制'); }
  let manifest;
  try { manifest = JSON.parse(Buffer.concat(chunks)); } catch { throw new APIError(502, 'invalid_node_manifest', '节点信息不是有效 JSON'); }
  if (manifest?.protocol !== 'agentroom-node/1' || !/^node_[A-Za-z0-9_-]{1,100}$/.test(manifest.id) || !safeName(manifest.name) ||
    !Array.isArray(manifest.agents) || !manifest.agents.length || manifest.agents.length > 3 || new Set(manifest.agents.map(a => a?.id)).size !== manifest.agents.length) throw new APIError(400, 'invalid_node_manifest', '节点身份或助手列表无效');
  const agents = manifest.agents.map(agent => {
    if (!['codex', 'claude', 'pi'].includes(agent?.id) || !safeName(agent.name) || agent.taskIdScheme !== 'messageId' ||
      agent.url !== `${origin}/agents/${agent.id}`) throw new APIError(400, 'invalid_node_manifest', '节点中的助手地址必须属于同一台服务器');
    return { id: agent.id, name: agent.name, url: agent.url, availability: ['configured', 'not_installed', 'login_required'].includes(agent.availability) ? agent.availability : 'unknown' };
  });
  return { id: manifest.id, name: manifest.name, origin, agents, checkedAt: now(), status: 'reachable' };
}

/** Enrollment creates ordinary A2A connections; no new execution scheduler. */
export class RemoteNodes {
  constructor(store, publicConnection) { this.store = store; this.publicConnection = publicConnection; }
  list() {
    return this.store.list('remote_node').flatMap(node => {
      const connections = this.store.list('connection').filter(c => c.node?.id === node.id);
      if (!connections.length) return [];
      const { credentialFingerprint: _private, ...value } = node;
      return [{ ...value, agents: connections.map(connection => {
        const observed = node.agents.find(a => a.id === connection.node.agentId);
        return { id: connection.node.agentId, name: observed?.name || ({ codex: 'Codex', claude: 'Claude Code', pi: 'Pi' })[connection.node.agentId],
          url: connection.url, availability: observed?.availability || 'withdrawn', connectionId: connection.id };
      }) }];
    });
  }
  async connect(body) {
    if (!body || Object.keys(body).some(k => !['url', 'token', 'clientId'].includes(k))) throw new APIError(400, 'bad_request', '节点只接受地址、令牌和请求标识');
    const origin = originURL(body.url), token = validateBearerToken(body.token);
    if (!token || !/^[A-Za-z0-9_-]{32,512}$/.test(token)) throw new APIError(400, 'node_token_required', '请填写节点生成的访问令牌');
    const fingerprint = this.store.vault.fingerprint(token, 'node', origin), input = { origin, credentialFingerprint: fingerprint };
    if (body.clientId) { const receipt = this.store.replay('nodes:connect', body.clientId, input); if (receipt.found) return receipt.value; }
    const known = this.list().find(n => n.origin === origin);
    if (known && this.store.require('remote_node', known.id).credentialFingerprint !== fingerprint) throw new APIError(409, 'node_credentials_changed', '这台服务器已使用另一个令牌连接；请先处理旧任务并移除原连接');
    const node = await inspect(origin, { Authorization: `Bearer ${token}` });
    if (known && known.id !== node.id || this.list().some(n => n.id === node.id && n.origin !== origin)) throw new APIError(409, 'node_identity_changed', '服务器身份或地址已改变，请先核对并移除原连接');
    const created = [];
    const save = () => {
      // Discovery awaited network I/O. Re-read authority inside the write
      // transaction; another enrollment may have committed while it waited.
      const current = this.list();
      const atOrigin = current.find(n => n.origin === origin);
      if (atOrigin && atOrigin.id !== node.id || current.some(n => n.id === node.id && n.origin !== origin)) throw new APIError(409, 'node_identity_changed', '服务器身份或地址已改变，请先核对并移除原连接');
      if (atOrigin && this.store.require('remote_node', atOrigin.id).credentialFingerprint !== fingerprint) throw new APIError(409, 'node_credentials_changed', '服务器已登记其他凭据，请先处理旧任务并移除原连接');
      const connections = node.agents.map(agent => {
        const previous = this.store.list('connection').find(c => c.node?.id === node.id && c.node.agentId === agent.id);
        if (previous) return previous;
        const connection = { id: id('con'), name: `${agent.name} · ${node.name}`, type: 'a2a', url: agent.url, createdAt: now(), checkedAt: node.checkedAt,
          credentialVersion: 1, node: { id: node.id, name: node.name, agentId: agent.id, origin, taskIdScheme: 'messageId' } };
        created.push(connection.id);
        connection.credentialRef = this.store.vault.create(token, connection);
        connection.credentialFingerprint = this.store.vault.fingerprint(token, 'a2a', agent.url);
        return this.store.put('connection', connection);
      });
      this.store.put('remote_node', { ...node, credentialFingerprint: fingerprint });
      return { node: this.list().find(n => n.id === node.id), connections: connections.map(this.publicConnection) };
    };
    try { return body.clientId ? this.store.idempotent('nodes:connect', body.clientId, input, save) : this.store.transaction(save); }
    catch (error) { for (const connectionId of created) this.store.vault.removeForConnection(connectionId); throw error; }
  }
  async check(nodeId) {
    const node = this.store.require('remote_node', nodeId), connection = this.store.list('connection').find(c => c.node?.id === node.id);
    if (!connection) throw new APIError(404, 'node_not_connected', '这个节点已经移除');
    try {
      const observed = await inspect(node.origin, this.store.vault.authorization(connection));
      if (observed.id !== node.id) throw new APIError(409, 'node_identity_changed', '远端节点身份已变化，请核对后重新连接');
      this.store.put('remote_node', { ...node, ...observed });
    } catch (error) {
      this.store.put('remote_node', { ...node, checkedAt: now(), status: 'unreachable', error: error.message });
      throw error;
    }
    return this.list().find(n => n.id === node.id);
  }
}
