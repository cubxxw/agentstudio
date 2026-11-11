import { validateConfiguration, resolveExecution } from './agent-profiles.mjs';
import { APIError, id, now } from './store.mjs';

const SELF = 'self';
const policies = ['auto', 'mention', 'always', 'manual'];
const icons = ['auto', 'spark', 'code', 'research', 'write', 'compass', 'brain', 'person'];
const colors = ['blue', 'violet', 'teal', 'orange', 'rose'];
const fail = (message, status = 400, code = 'bad_request') => { throw new APIError(status, code, message); };
const text = (value, max, fallback = '') => {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > max) fail(`请输入 ${max} 字以内的文本`);
  return value.trim();
};
const identity = contact => ({ id: contact.id, kind: contact.kind, name: contact.name, handle: contact.handle,
  description: contact.description, instructions: contact.instructions, color: contact.color, icon: contact.icon || 'auto', avatarAgent: contact.binding?.type === 'local' ? contact.binding.localAgentId : null, version: contact.version });

/** Personal, single-owner address book. Discovery updates capability facts, never a user's identity. */
export class Messenger {
  constructor(store) {
    this.store = store;
    if (!store.get('contact', SELF)) store.put('contact', { id: SELF, kind: 'human', name: '你', handle: 'you',
      description: '这台 Mac 的使用者', instructions: '', color: 'blue', version: 1, availability: 'self', createdAt: now() });
  }

  sync(detected) {
    for (const agent of detected.agents) {
      const contactId = `agent_${agent.id}`, previous = this.store.get('contact', contactId);
      this.putDiscovered({ id: contactId, kind: 'agent', name: agent.name, handle: agent.id,
        description: '这台 Mac 上的助手', instructions: '', color: agent.id === 'codex' ? 'blue' : 'violet',
        version: 1, createdAt: now(), ...previous, added: previous ? previous.added !== false : false, discovered: true, binding: { type: 'local', localAgentId: agent.id },
        availability: !agent.installed ? 'not_installed' : !agent.execution.supported ? 'unsupported' : agent.auth.status === 'configured' ? 'ready' : 'login_required',
        profile: agent.profile || null, availabilityReason: agent.execution.reason || '', providerName: agent.name });
    }
    for (const connection of this.store.list('connection')) {
      const contactId = `connection_${connection.id}`, previous = this.store.get('contact', contactId);
      const handle = `remote-${connection.id.replace(/[^a-z0-9]/gi, '').slice(-12).toLowerCase()}`;
      this.putDiscovered({ id: contactId, kind: 'agent', name: connection.name, handle,
        description: connection.type === 'mcp' ? '已连接的工具助手' : '已连接的个人 Agent', instructions: '', color: 'teal',
        version: 1, createdAt: now(), ...previous, discovered: true,
        binding: { type: 'connection', connectionId: connection.id }, availability: 'ready', providerName: connection.name });
    }
    return this.contacts();
  }

  putDiscovered(value) { const previous = this.store.get('contact', value.id); if (JSON.stringify(previous) !== JSON.stringify(value)) this.store.put('contact', value); }

  publicContact(contact) {
    const binding = contact.binding;
    const connection = binding?.type === 'connection' ? this.store.get('connection', binding.connectionId) : null;
    const chatBinding = connection?.type === 'mcp' ? contact.chatBackend : binding;
    const base = chatBinding?.type === 'local' ? this.store.get('contact', `agent_${chatBinding.localAgentId}`) : null;
    let execution = null, configurationError = '';
    const profile = base?.profile || (contact.discovered ? contact.profile : null);
    if (connection?.type === 'mcp' && !chatBinding) configurationError = '请在联系人设置中明确选择聊天助手，工具连接本身没有对话模型';
    if (contact.kind === 'agent' && chatBinding?.type === 'local' && profile) { try { execution = resolveExecution(profile, contact.configuration || {}); } catch (error) { configurationError = error.message; } }
    return { ...contact, connectionType: connection?.type || null, profile, execution, configurationError, ...(contact.kind === 'human' ? { availability: contact.id === SELF ? 'self' : 'local_only' }
      : configurationError ? { availability: 'configuration_required', providerName: connection?.name || base?.providerName || '' }
      : chatBinding?.type === 'local' ? { availability: base?.availability || 'not_installed', providerName: connection?.name || base?.providerName || chatBinding.localAgentId }
        : { availability: connection ? 'ready' : 'disconnected', providerName: connection?.name || '连接已移除' }) };
  }
  contacts() { return this.store.list('contact').map(c => this.publicContact(c)).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')); }

  addLocalAgents(body, detected) {
    if (!Array.isArray(body.agentIds) || !body.agentIds.length || body.agentIds.length > 5
      || body.agentIds.some(value => !['codex', 'claude', 'pi'].includes(value))) fail('请选择支持聊天的本机助手');
    const agentIds = [...new Set(body.agentIds)];
    // Validate the entire fresh inventory before changing any relationship.
    for (const agentId of agentIds) {
      const agent = detected.agents.find(item => item.id === agentId);
      if (!agent?.installed || agent.execution?.supported !== true) fail('这个助手尚未安装或暂不支持聊天，请重新检查', 409, 'local_agent_unavailable');
    }
    return agentIds.map(agentId => {
      const contact = this.store.require('contact', `agent_${agentId}`);
      if (contact.added === false) this.store.put('contact', { ...contact, added: true, addedAt: now() });
      return this.publicContact(this.store.require('contact', contact.id));
    });
  }

  saveContact(body, contactId) {
    const previous = contactId ? this.store.require('contact', contactId) : null;
    if (contactId === SELF) fail('本机本人身份不能通过联系人编辑');
    if (previous && body.version !== previous.version) fail('联系人已更新，请重新打开后编辑', 409, 'version_conflict');
    const kind = body.kind ?? previous?.kind;
    if (!['agent', 'human'].includes(kind) || (previous && kind !== previous.kind)) fail('联系人类型必须为人或 Agent，保存后不能更换');
    const name = text(body.name ?? previous?.name, 80), handle = text(body.handle ?? previous?.handle, 32).toLowerCase();
    if (!name) fail('请填写联系人名称');
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(handle) || ['all', 'you', 'self'].includes(handle)) fail('用户名使用 2–32 位小写字母、数字、下划线或短横线，并以字母开头');
    if (this.store.list('contact').some(c => c.id !== contactId && c.handle === handle)) fail('这个用户名已被使用', 409, 'handle_taken');
    let binding = body.binding ?? previous?.binding ?? null;
    if (kind === 'agent') {
      if (binding?.type === 'local') {
        if (!this.store.get('contact', `agent_${binding.localAgentId}`)) fail('请先发现这个本机助手');
        binding = { type: 'local', localAgentId: binding.localAgentId };
      } else if (binding?.type === 'connection') {
        this.store.require('connection', binding.connectionId);
        binding = { type: 'connection', connectionId: binding.connectionId };
      } else fail('请为 Agent 选择一个已发现的助手或连接');
      if (previous?.discovered && JSON.stringify(binding) !== JSON.stringify(previous.binding)) fail('系统联系人不能更换执行后端，请创建新身份');
    } else if (binding) fail('人类联系人不能绑定 Agent 后端');
    const color = body.color ?? previous?.color ?? 'blue';
    if (!colors.includes(color)) fail('请选择提供的头像颜色');
    let configuration;
    try { configuration = validateConfiguration(body.configuration ?? previous?.configuration ?? {}); } catch (error) { fail(error.message); }
    const toolConnection = binding?.type === 'connection' && this.store.require('connection', binding.connectionId).type === 'mcp';
    let chatBackend = body.chatBackend === undefined ? previous?.chatBackend || null : body.chatBackend;
    if (chatBackend) {
      if (!toolConnection || chatBackend.type !== 'local' || !['codex', 'claude', 'pi'].includes(chatBackend.localAgentId) || !this.store.get('contact', `agent_${chatBackend.localAgentId}`)) fail('工具连接的聊天助手必须是已发现、支持执行的本机助手');
      chatBackend = { type: 'local', localAgentId: chatBackend.localAgentId };
    }
    if (kind === 'agent' && binding?.type === 'connection' && !chatBackend && (configuration.modelMode !== 'follow' || configuration.thinking !== 'follow')) fail('这个连接由服务管理模型，不能使用本机 CLI 模型选项');
    const icon = body.icon ?? previous?.icon ?? 'auto';
    if (!icons.includes(icon)) fail('请选择支持的联系人图标');
    const contact = this.store.put('contact', { ...previous, id: contactId || id('contact'), kind, name, handle,
      description: text(body.description ?? previous?.description, 300), instructions: kind === 'agent' ? text(body.instructions ?? previous?.instructions, 3000) : '',
      binding, color, icon, ...(kind === 'agent' ? { configuration, chatBackend: toolConnection ? chatBackend : null } : {}), version: (previous?.version || 0) + 1, createdAt: previous?.createdAt || now(), updatedAt: now() });
    return this.publicContact(contact);
  }

  members(values) {
    if (!Array.isArray(values) || values.length < 1 || values.length > 30 || values.some(v => typeof v !== 'string')) fail('请选择 1–30 位联系人');
    const ids = [...new Set([SELF, ...values])];
    for (const memberId of ids) this.store.require('contact', memberId);
    if (ids.length < 2) fail('请选择至少一位其他联系人');
    return ids;
  }
  createChat(body) {
    if (!['direct', 'group'].includes(body.kind)) fail('请选择私聊或群聊');
    const memberIds = this.members(body.memberIds);
    if (body.kind === 'direct' && memberIds.length !== 2) fail('私聊只能有你和一位联系人');
    if (body.kind === 'direct') {
      const peer = this.store.require('contact', memberIds.find(x => x !== SELF));
      if (peer.added === false) this.store.put('contact', { ...peer, added: true, addedAt: now() });
      const existing = this.store.list('thread').find(t => t.kind === 'direct' && t.memberIds.includes(memberIds.find(x => x !== SELF)));
      if (existing) return existing;
    }
    const title = body.kind === 'direct' ? this.store.require('contact', memberIds.find(x => x !== SELF)).name : text(body.title, 80);
    if (!title) fail('请填写群名称');
    const thread = { id: id('thr'), kind: body.kind, title, memberIds, version: 1,
      members: memberIds.map(contactId => ({ contactId, visibleAfterMessageId: null })), responsePolicies: {},
      status: 'completed', summary: '', createdAt: now(), updatedAt: now(), messages: [], runs: [], artifacts: [], decisions: [], events: [], memoryIds: [] };
    return this.store.put('thread', thread);
  }

  updateChat(threadId, body) {
    const thread = this.store.require('thread', threadId);
    if (thread.kind !== 'group') fail('只有群聊可以修改成员和群响应策略');
    if (body.version !== thread.version) fail('群信息已更新，请重新打开后编辑', 409, 'version_conflict');
    const memberIds = body.memberIds === undefined ? thread.memberIds : this.members(body.memberIds);
    // Removing a member does not cancel accepted work or grant visibility on rejoin.
    const members = memberIds.map(contactId => thread.members.find(m => m.contactId === contactId) || { contactId, visibleAfterMessageId: thread.messages.at(-1)?.id || null });
    const responsePolicies = { ...thread.responsePolicies };
    if (body.responsePolicies !== undefined) {
      if (!body.responsePolicies || typeof body.responsePolicies !== 'object' || Array.isArray(body.responsePolicies)) fail('响应策略必须是对象');
      for (const [contactId, policy] of Object.entries(body.responsePolicies)) {
        if (!memberIds.includes(contactId) || this.store.require('contact', contactId).kind !== 'agent' || !policies.includes(policy)) fail('只能设置群内 Agent 的响应策略');
        responsePolicies[contactId] = policy;
      }
    }
    const title = body.title === undefined ? thread.title : text(body.title, 80);
    if (!title) fail('请填写群名称');
    Object.assign(thread, { title, memberIds, members, responsePolicies, version: thread.version + 1, updatedAt: now() });
    return this.store.put('thread', thread);
  }

  appendMessage(thread, body, validateInput) {
    const basic = validateInput({ ...body, mode: 'local', localAgentId: 'codex', action: undefined });
    const reply = body.replyTo ? thread.messages.find(m => m.id === body.replyTo) : null;
    if (body.replyTo && !reply) fail('回复的消息已不存在');
    const mentions = new Set([...basic.text.matchAll(/(^|[^\p{L}\p{N}_@])@([a-z][a-z0-9_-]{1,31})(?![\p{L}\p{N}_-])/giu)].map(m => m[2].toLowerCase()));
    const targets = thread.memberIds.filter(x => x !== SELF).map(x => this.publicContact(this.store.require('contact', x))).filter(contact => {
      if (contact.kind !== 'agent') return false;
      if (thread.kind === 'direct') return true;
      const policy = thread.responsePolicies[contact.id] || 'auto';
      return policy !== 'manual' && (policy === 'auto' || policy === 'always' || mentions.has('all') || mentions.has(contact.handle) || reply?.contactId === contact.id);
    });
    const skippedContacts = [];
    const inputs = targets.flatMap(contact => {
      const uncertain = thread.runs.some(run => run.contactId === contact.id && (this.store.unresolved(run) || run.requiresReconciliation));
      if (contact.availability !== 'ready' || uncertain) {
        const reason = uncertain ? '原任务结果尚未核查' : contact.configurationError || contact.availabilityReason || '连接或登录暂不可用';
        if (thread.kind === 'direct' || mentions.has(contact.handle) || reply?.contactId === contact.id) fail(`${contact.name} 暂时不能回复：${reason}，请在联系人或原任务中处理`, 409, 'agent_unavailable');
        skippedContacts.push({ id: contact.id, name: contact.name, reason });
        return [];
      }
      const binding = contact.binding;
      const input = validateInput({ ...body, mode: binding.type === 'local' ? 'codex' : 'connection',
        localAgentId: binding.localAgentId || contact.chatBackend?.localAgentId || 'codex', connectionId: binding.connectionId, action: undefined });
      const goal = this.store.get('agent_control', contact.id)?.goal;
      return [{ ...input, ...(contact.execution ? { executionSnapshot: structuredClone(contact.execution) } : {}), contactId: contact.id, contactSnapshot: { ...identity(contact), ...(goal?.text ? { goal: structuredClone(goal) } : {}) },
        participantSnapshot: thread.memberIds.map(x => { const { instructions: _instructions, ...peer } = identity(this.store.require('contact', x)); return peer; }),
        conversationSnapshot: { kind: thread.kind, title: thread.title, version: thread.version,
          attention: { addressedContactIds: thread.memberIds.filter(contactId => {
            const member = this.store.require('contact', contactId);
            return member.kind === 'agent' && (mentions.has('all') || mentions.has(member.handle));
          }), replyToContactId: reply?.contactId || null,
          explicitlyAddressed: thread.kind === 'direct' || mentions.has('all') || mentions.has(contact.handle) || reply?.contactId === contact.id } },
        visibleAfterMessageId: thread.members.find(m => m.contactId === contact.id)?.visibleAfterMessageId || null,
        responsePolicy: thread.kind === 'direct' ? 'direct' : thread.responsePolicies[contact.id] || 'auto' }];
    });
    let messageId;
    for (const input of inputs) {
      const run = this.store.appendRun(thread, { ...input, ...(messageId ? { reuseMessageId: messageId } : {}) });
      messageId = run.messageId;
    }
    if (!inputs.length) {
      messageId = id('msg');
      thread.messages.push({ id: messageId, role: 'user', text: basic.text, attachments: basic.attachments.map(a => ({ ...a, id: id('att'), size: Buffer.byteLength(a.text) })), createdAt: now() });
    }
    const message = thread.messages.find(m => m.id === messageId);
    Object.assign(message, { contactId: SELF, recipientIds: [...thread.memberIds], replyTo: reply?.id || null, ...(skippedContacts.length ? { skippedContacts } : {}), deliveryState: thread.memberIds.some(x => x !== SELF && this.store.require('contact', x).kind === 'human') ? 'local_only' : 'saved' });
    if (!inputs.length) thread.summary = basic.text.slice(0, 120);
    thread.updatedAt = now();
    return this.store.put('thread', thread);
  }

  approvals() {
    return this.store.list('thread').flatMap(thread => thread.decisions.map(decision => {
      const run = thread.runs.find(r => r.id === decision.runId);
      return { ...decision, threadId: thread.id, threadTitle: thread.title, contact: run?.contactSnapshot || null };
    })).sort((a, b) => (a.state === 'pending' ? 0 : 1) - (b.state === 'pending' ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}
