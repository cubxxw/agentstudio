import { useRef, useState } from "react";
import { Bot, Check, Plus, UserRound, Users } from "lucide-react";
import { api, key } from "./api";
import { Modal } from "./App";
import type { Contact, ResponsePolicy, Thread } from "./types";

export const availabilityText: Record<Contact["availability"], string> = {
  ready: "可以开始聊天", self: "本人", local_only: "本地联系人 · 尚未接入消息网络",
  unsupported: "已发现 · 暂不支持执行", not_installed: "尚未安装", login_required: "需要登录", disconnected: "连接已移除",
};
export function Avatar({ contact, group, size = "" }: { contact?: Pick<Contact, "name" | "color" | "kind">; group?: boolean; size?: string }) {
  return <span className={`im-avatar ${contact?.color || "blue"} ${size}`} aria-hidden="true">
    {group ? <Users size={22} /> : contact ? contact.name.trim().slice(0, 1).toUpperCase() : <Bot size={23} />}
    {contact?.kind === "agent" && <span className="im-agent-mark"><Bot size={10} /></span>}
  </span>;
}

export function ContactEditor({ contact, contacts, initialKind = "agent", onClose, onSaved }: {
  contact?: Contact; contacts: Contact[]; initialKind?: "agent" | "human"; onClose: () => void; onSaved: (contact: Contact) => Promise<void>;
}) {
  const [kind, setKind] = useState(contact?.kind || initialKind);
  const [name, setName] = useState(contact?.name || "");
  const [handle, setHandle] = useState(contact?.handle || `agent-${key().slice(0, 6)}`);
  const [description, setDescription] = useState(contact?.description || "");
  const [instructions, setInstructions] = useState(contact?.instructions || "");
  const [color, setColor] = useState(contact?.color || "blue");
  const backends = contacts.filter(c => c.kind === "agent" && c.discovered);
  const preferred = backends.find(c => c.availability === "ready" && c.binding?.type === "local" && c.binding.localAgentId === "codex") || backends.find(c => c.availability === "ready" && c.binding?.type === "local") || backends.find(c => c.availability === "ready");
  const [backend, setBackend] = useState(contact?.binding ? JSON.stringify(contact.binding) : JSON.stringify(preferred?.binding || backends[0]?.binding || null));
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; clientId: string } | null>(null);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const fields = { kind, name, handle, description, instructions, color, binding: kind === "agent" ? JSON.parse(backend) : null, ...(contact ? { version: contact.version } : {}) };
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
      <div className="im-identity-preview"><Avatar contact={{ name: name || "A", color, kind }} size="large" /><span>{name || "新的联系人"}<small>@{handle}</small></span></div>
      <label>名称<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} data-testid="im-contact-name" /></label>
      <label>用户名<span className="im-field-hint">群聊中通过 @{handle} 提及</span><input required pattern="[a-z][a-z0-9_-]{1,31}" maxLength={32} value={handle} onChange={e => setHandle(e.target.value.toLowerCase())} data-testid="im-contact-handle" /></label>
      <label>简介<input maxLength={300} placeholder="一句话介绍这位联系人" value={description} onChange={e => setDescription(e.target.value)} data-testid="im-contact-description" /></label>
      {kind === "agent" && <>
        <label>使用哪个助手<select value={backend} disabled={contact?.discovered} onChange={e => setBackend(e.target.value)} data-testid="im-contact-backend">
          {!backends.length && <option value="null">请先在设置中连接助手</option>}
          {backends.map(c => <option key={c.id} value={JSON.stringify(c.binding)}>{c.providerName || c.name} · {availabilityText[c.availability]}</option>)}
        </select></label>
        <label>身份与回复方式<textarea rows={4} maxLength={3000} placeholder="例如：你是我的研究伙伴，先核对来源，再给出简洁结论。" value={instructions} onChange={e => setInstructions(e.target.value)} data-testid="im-contact-instructions" /></label>
        <p className="im-field-hint">身份和聊天记录保存在这台 Mac。更改身份从下一条消息起生效。</p>
      </>}
      {kind === "human" && <p className="im-callout">先保存到本机通讯录。对方尚不能收到消息，后续接入消息网络后再启用投递。</p>}
      <div className="im-colors" aria-label="头像颜色">{["blue", "violet", "teal", "orange", "rose"].map(c => <button className={`im-color ${c}`} type="button" key={c} aria-label={`${c}头像`} aria-pressed={color === c} onClick={() => setColor(c)}>{color === c && <Check size={15} />}</button>)}</div>
      {error && <p role="alert" className="im-error">{error}</p>}
      <button className="im-primary" disabled={busy || (kind === "agent" && backend === "null")} data-testid="im-contact-save">{busy ? "正在保存…" : contact ? "保存更改" : "添加联系人"}</button>
    </form>
  </Modal>;
}

export function GroupEditor({ thread, contacts, initialMembers = [], onClose, onSaved }: {
  thread?: Thread; contacts: Contact[]; initialMembers?: string[]; onClose: () => void; onSaved: (thread: Thread) => Promise<void>;
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
        {thread && members.includes(c.id) && c.kind === "agent" && <select aria-label={`${c.name}的响应策略`} data-testid={`im-policy-${c.id}`} value={responsePolicies[c.id] || "mention"} onChange={e => setPolicies(p => ({ ...p, [c.id]: e.target.value as ResponsePolicy }))}><option value="mention">仅提及或回复时</option><option value="always">每条消息</option><option value="manual">暂停回应</option></select>}
      </div>)}</div>
      <p className="im-field-hint">默认 @提及 或回复某位 Agent 才回应。新成员只收到加入后的内容；已接受的运行保持原身份。人类成员当前仅保存在本机。</p>
      {error && <p role="alert" className="im-error">{error}</p>}
      <button className="im-primary" disabled={busy || !members.length} data-testid="im-group-save">{busy ? "正在保存…" : thread ? "保存群信息" : <><Plus size={17} />创建群聊</>}</button>
    </form>
  </Modal>;
}
