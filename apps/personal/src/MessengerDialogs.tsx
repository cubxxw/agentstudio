import { useRef, useState } from "react";
import { Bot, Check, Plus, Settings2, UserRound, Users } from "lucide-react";
import { api, key } from "./api";
import { Modal } from "./ConversationPanels";
import { Avatar, avatarIcons, avatarLabels } from "./ContactAvatar";
import { AgentOptions } from "./AgentOptions";
export { Avatar } from "./ContactAvatar";
import type { AgentConfiguration, Contact, ResponsePolicy, Thread } from "./types";

export const availabilityText: Record<Contact["availability"], string> = {
  ready: "已连接", configuration_required: "需要完善配置", self: "本人", local_only: "本地联系人 · 尚未接入消息网络",
  unsupported: "已发现 · 暂不支持执行", not_installed: "尚未安装", login_required: "需要登录", disconnected: "连接已移除",
};
export function ContactEditor({ contact, contacts, initialKind = "agent", onClose, onSaved, onRefresh }: {
  contact?: Contact; contacts: Contact[]; initialKind?: "agent" | "human"; onClose: () => void; onRefresh: () => Promise<void>; onSaved: (contact: Contact) => Promise<void>;
}) {
  const backends = contacts.filter(c => c.kind === "agent" && c.discovered);
  const preferred = backends.find(c => c.availability === "ready" && c.binding?.type === "local" && c.binding.localAgentId === "codex") || backends.find(c => c.availability === "ready") || backends[0];
  const [kind, setKind] = useState(contact?.kind || initialKind);
  const [backend, setBackend] = useState(JSON.stringify(contact?.binding || preferred?.binding || null));
  const selectedBackend = backends.find(c => JSON.stringify(c.binding) === backend);
  const isToolConnection = selectedBackend?.binding?.type === "connection" && selectedBackend.connectionType === "mcp";
  const [chatBackend, setChatBackend] = useState(contact?.chatBackend ? JSON.stringify(contact.chatBackend) : "");
  const chatBackends = backends.filter(c => c.binding?.type === "local" && ["ready", "configuration_required"].includes(c.availability));
  const selectedChatBackend = backends.find(c => c.binding?.type === "local" && JSON.stringify(c.binding) === chatBackend);
  const effectiveBackend = isToolConnection ? selectedChatBackend : selectedBackend;
  const [name, setName] = useState(contact?.name || preferred?.name || "");
  const [handle, setHandle] = useState(contact?.handle || `agent-${key().slice(0, 6)}`);
  const [description, setDescription] = useState(contact?.description || "");
  const [instructions, setInstructions] = useState(contact?.instructions || "");
  const [color, setColor] = useState(contact?.color || "blue");
  const [icon, setIcon] = useState(contact?.icon || "auto");
  const [configuration, setConfiguration] = useState<AgentConfiguration>(contact?.configuration || { modelMode: "follow", thinking: "follow" });
  const [refreshing, setRefreshing] = useState(false);
  const [identityNotice, setIdentityNotice] = useState("");
  const extractIdentity = async () => {
    setRefreshing(true); setError("");
    try {
      const result = await api<{ instructions: string; sources: string[]; truncated: boolean }>("/integrations/local/pi/identity", {});
      if (result.instructions) { setInstructions(result.instructions); setIdentityNotice(`已读取 ${result.sources.join("、")}${result.truncated ? " 的前 3000 字" : ""}，请检查后保存。`); }
      else setIdentityNotice("未发现 Pi 保存的 SYSTEM.md 或 APPEND_SYSTEM.md，可以直接在下方定义身份。");
    } catch (e) { setError(e instanceof Error ? e.message : "无法提取身份"); }
    finally { setRefreshing(false); }
  };
  const refreshProfile = async () => { setRefreshing(true); setError(""); try { await api("/integrations/refresh", {}); await onRefresh(); } catch (e) { setError(e instanceof Error ? e.message : "无法读取配置"); } finally { setRefreshing(false); } };
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; clientId: string } | null>(null);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const fields = { kind, name, handle, description, instructions, color, icon, ...(kind === "agent" ? { configuration, chatBackend: isToolConnection && chatBackend ? JSON.parse(chatBackend) : null } : {}), binding: kind === "agent" ? JSON.parse(backend) : null, ...(contact ? { version: contact.version } : {}) };
      const signature = JSON.stringify(fields);
      if (pending.current?.signature !== signature) pending.current = { signature, clientId: key() };
      const saved = await api<Contact>(contact ? `/contacts/${contact.id}` : "/contacts", { ...fields, clientId: pending.current.clientId });
      await onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : "联系人尚未保存，请重试"); }
    finally { setBusy(false); }
  };
  return <Modal title={contact ? "编辑联系人" : "添加联系人"} className="im-dialog" onClose={onClose}>
    <form className="im-form" onSubmit={event => { event.preventDefault(); void submit(); }} data-testid="im-contact-editor">
      {!contact && <div className="im-segment" aria-label="联系人类型">
        <button type="button" aria-pressed={kind === "agent"} data-testid="im-kind-agent" onClick={() => setKind("agent")}><Bot size={16} />Agent</button>
        <button type="button" aria-pressed={kind === "human"} data-testid="im-kind-human" onClick={() => setKind("human")}><UserRound size={16} />人</button>
      </div>}
      <div className="im-identity-preview"><Avatar contact={{ name: name || "A", color, kind, icon, binding: selectedBackend?.binding || null }} size="large" /><span>{name || "新的联系人"}<small>@{handle}</small></span></div>
      <label>名称<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} data-testid="im-contact-name" /></label>
      <label>用户名<span className="im-field-hint">群聊中通过 @{handle} 提及</span><input required pattern="[a-z][a-z0-9_-]{1,31}" maxLength={32} value={handle} onChange={e => setHandle(e.target.value.toLowerCase())} data-testid="im-contact-handle" /></label>
      <label>简介<input maxLength={300} placeholder="一句话介绍这位联系人" value={description} onChange={e => setDescription(e.target.value)} data-testid="im-contact-description" /></label>
      {kind === "agent" && <>
        <label>使用哪个助手<select value={backend} disabled={contact?.discovered || refreshing} onChange={e => { const next = backends.find(c => JSON.stringify(c.binding) === e.target.value); if (!contact && name === selectedBackend?.name) setName(next?.name || ""); setBackend(e.target.value); setChatBackend(""); setConfiguration({ modelMode: "follow", thinking: "follow" }); }} data-testid="im-contact-backend">
          {!backends.length && <option value="null">请先在设置中连接助手</option>}
          {backends.map(c => <option key={c.id} value={JSON.stringify(c.binding)}>{c.providerName || c.name} · {availabilityText[c.availability]}</option>)}
        </select></label>
        {isToolConnection && <>
          <label>聊天助手<select value={chatBackend} disabled={refreshing || busy} data-testid="im-contact-chat-backend" onChange={event => { setChatBackend(event.target.value); setConfiguration({ modelMode: "follow", thinking: "follow" }); }}><option value="">请选择聊天助手</option>{chatBackend && !chatBackends.some(c => JSON.stringify(c.binding) === chatBackend) && <option value={chatBackend} disabled>{selectedChatBackend?.name || "原聊天助手"} · 当前不可用</option>}{chatBackends.map(c => <option key={c.id} value={JSON.stringify(c.binding)}>{c.providerName || c.name} · {availabilityText[c.availability]}</option>)}</select></label>
          <p className="im-field-hint" data-testid="im-contact-chat-backend-hint">{chatBackend ? "这位本机助手负责对话与规划，原工具连接保持不变。工具操作仍需逐项确认。" : "这是工具连接。选择聊天助手并保存后，才能发送新消息。可以先保存联系人，稍后补齐。"}</p>
        </>}
        {(!isToolConnection || selectedChatBackend) && <AgentOptions profile={effectiveBackend?.profile} value={configuration} onChange={setConfiguration} refreshing={refreshing} onRefresh={() => void refreshProfile()} />}
        {effectiveBackend?.binding?.type === "local" && effectiveBackend.binding.localAgentId === "pi" && <div className="im-identity-import"><button type="button" className="im-text-button" disabled={refreshing || Boolean(instructions.trim())} data-testid="im-extract-identity" onClick={() => void extractIdentity()}>从 Pi 提取已保存的身份</button><p className="im-field-hint">{identityNotice || "读取 Pi 的全局身份文件，填入下方供你检查。已有身份请先清空，避免覆盖。"}</p></div>}
        <label>身份与回复方式<textarea rows={4} maxLength={3000} disabled={refreshing} placeholder="例如：你是我的研究伙伴，先核对来源，再给出简洁结论。" value={instructions} onChange={e => setInstructions(e.target.value)} data-testid="im-contact-instructions" /></label>
        <p className="im-field-hint">身份和聊天记录保存在这台 Mac。更改身份从下一条消息起生效。</p>
      </>}
      {kind === "human" && <p className="im-callout">先保存到本机通讯录。对方尚不能收到消息，后续接入消息网络后再启用投递。</p>}
      <div className="im-avatar-picker" aria-label="联系人图标">{Object.entries(avatarIcons).map(([id, Icon]) => <button key={id} type="button" aria-label={avatarLabels[id]} aria-pressed={icon === id} data-testid={`im-avatar-icon-${id}`} onClick={() => setIcon(id)}><Icon size={20} /></button>)}</div>
      <div className="im-colors" aria-label="头像颜色">{["blue", "violet", "teal", "orange", "rose"].map(c => <button className={`im-color ${c}`} type="button" key={c} aria-label={`${c}头像`} aria-pressed={color === c} onClick={() => setColor(c)}>{color === c && <Check size={15} />}</button>)}</div>
      {error && <p role="alert" className="im-error">{error}</p>}
      <button className="im-primary" disabled={busy || refreshing || (kind === "agent" && backend === "null")} data-testid="im-contact-save">{busy ? "正在保存…" : contact ? "保存更改" : "添加联系人"}</button>
    </form>
  </Modal>;
}

export function GroupEditor({ thread, contacts, initialMembers = [], onClose, onSaved, onOpenProfile }: {
  thread?: Thread; contacts: Contact[]; initialMembers?: string[]; onClose: () => void; onSaved: (thread: Thread) => Promise<void>; onOpenProfile?: (contact: Contact) => void;
}) {
  const [title, setTitle] = useState(thread?.title || "");
  const [members, setMembers] = useState(thread?.memberIds?.filter(x => x !== "self") || initialMembers);
  const [search, setSearch] = useState("");
  const [responsePolicies, setPolicies] = useState<Record<string, ResponsePolicy>>(thread?.responsePolicies || {});
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const request = useRef<{ signature: string; clientId: string } | null>(null);
  return <Modal title={thread ? "群聊信息" : "新建群聊"} onClose={onClose} className="im-dialog">
    <form className="im-form" data-testid="im-group-editor" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try {
        const fields = { kind: "group", title, memberIds: members, ...(thread ? { version: thread.version, responsePolicies: Object.fromEntries(Object.entries(responsePolicies).filter(([id]) => members.includes(id))) } : {}) };
        const signature = JSON.stringify(fields);
        if (request.current?.signature !== signature) request.current = { signature, clientId: key() };
        const saved = await api<Thread>(thread ? `/chats/${thread.id}` : "/chats", { ...fields, clientId: request.current.clientId });
        await onSaved(saved);
      } catch (e) { setError(e instanceof Error ? e.message : "群聊尚未保存"); }
      finally { setBusy(false); }
    }}>
      <div className="im-identity-preview"><Avatar group size="large" /><span>{thread ? "管理这段群聊" : "把伙伴聚在一起"}<small>你 + {members.length} 位联系人</small></span></div>
      <label>群名称<input autoFocus required maxLength={80} placeholder="例如：产品讨论" value={title} onChange={e => setTitle(e.target.value)} data-testid="im-group-name" /></label>
      <label>选择联系人<input type="search" placeholder="搜索名称或用户名" value={search} onChange={e => setSearch(e.target.value)} data-testid="im-group-search" /></label>
      <div className="im-member-picker">{contacts.filter(c => c.id !== "self" && `${c.name} ${c.handle}`.toLowerCase().includes(search.toLowerCase())).map(c => <div className="im-member-choice" key={c.id}>
        <label><input type="checkbox" checked={members.includes(c.id)} data-testid={`im-member-${c.id}`} onChange={e => setMembers(current => e.target.checked ? [...current, c.id] : current.filter(x => x !== c.id))} /><Avatar contact={c} /><span>{c.name}<small>{c.kind === "agent" ? c.providerName : "本地联系人"}</small></span></label>
        {thread && members.includes(c.id) && onOpenProfile && <button type="button" className="im-member-profile" aria-label={`查看${c.name}的设置`} title="联系人设置" data-testid={`im-member-profile-${c.id}`} onClick={() => onOpenProfile(c)}><Settings2 size={16} /></button>}
        {thread && members.includes(c.id) && c.kind === "agent" && <select aria-label={`${c.name}的响应策略`} data-testid={`im-policy-${c.id}`} value={responsePolicies[c.id] || "auto"} onChange={e => setPolicies(p => ({ ...p, [c.id]: e.target.value as ResponsePolicy }))}><option value="auto">按角色判断，可保持安静</option><option value="mention">仅提及或回复时</option><option value="always">每条消息</option><option value="manual">暂停回应</option></select>}
      </div>)}</div>
      <p className="im-field-hint">默认所有可用 Agent 收到消息后按角色判断是否回应，可保持安静；@ 表示明确找它。新成员只收到加入后的内容；已接受的运行保持原身份。人类成员当前仅保存在本机。</p>
      {error && <p role="alert" className="im-error">{error}</p>}
      <button className="im-primary" disabled={busy || !members.length} data-testid="im-group-save">{busy ? "正在保存…" : thread ? "保存群信息" : <><Plus size={17} />创建群聊</>}</button>
    </form>
  </Modal>;
}
