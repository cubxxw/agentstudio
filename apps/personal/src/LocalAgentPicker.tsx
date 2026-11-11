import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Laptop, Loader2, RefreshCw } from "lucide-react";
import { api, key } from "./api";
import { Avatar } from "./ContactAvatar";
import { availabilityText } from "./MessengerDialogs";
import type { Contact, Integrations, LocalAgentId } from "./types";
import "./local-agent-picker.css";

export function LocalAgentPicker({ onAdded, onOpen, onConnect }: {
  onAdded: () => Promise<void>; onOpen: (contact: Contact) => Promise<void>; onConnect: () => void;
}) {
  const [inventory, setInventory] = useState<Integrations | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<LocalAgentId[]>([]);
  const [result, setResult] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const alive = useRef(true), action = useRef(false), sequence = useRef(0);
  const pending = useRef<{ signature: string; clientId: string } | null>(null);
  const load = useCallback(async (force = false) => {
    const version = ++sequence.current;
    setLoading(true); setError("");
    try {
      const next = await api<Integrations>(force ? "/integrations/refresh" : "/integrations", force ? {} : undefined);
      const people = await api<{ contacts: Contact[] }>("/contacts");
      if (!alive.current || version !== sequence.current) return;
      setInventory(next); setContacts(people.contacts);
      setSelected(previous => previous.filter(id => next.agents.some(a => a.id === id && a.installed && a.execution.supported)
        && people.contacts.some(c => c.id === `agent_${id}` && c.added === false)));
    } catch (e) { if (alive.current && version === sequence.current) setError(e instanceof Error ? e.message : "暂时无法检查本机助手"); }
    finally { if (alive.current && version === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; sequence.current++; }; }, [load]);
  const add = async () => {
    if (action.current || loading || !selected.length) return;
    action.current = true; setBusy(true); setError("");
    const agentIds = [...selected].sort(), signature = JSON.stringify(agentIds);
    if (pending.current?.signature !== signature) pending.current = { signature, clientId: key() };
    try {
      const saved = await api<{ contacts: Contact[] }>("/contacts/local", { agentIds, clientId: pending.current.clientId });
      if (!alive.current) return;
      setResult(saved.contacts); setSelected([]);
      setContacts(previous => previous.map(c => saved.contacts.find(next => next.id === c.id) || c));
      await onAdded();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "尚未完成添加，请重试"); }
    finally { action.current = false; if (alive.current) setBusy(false); }
  };
  const open = async (contact: Contact) => {
    if (action.current) return;
    action.current = true; setBusy(true); setError("");
    try { await onOpen(contact); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "暂时无法打开聊天"); }
    finally { action.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="im-local-picker" data-testid="im-local-picker">
    <header><div><Laptop size={17} /><h3>把本机助手加进来</h3></div><button className="im-icon" data-testid="im-local-refresh" aria-label="重新检查本机助手" disabled={loading || busy} onClick={() => void load(true)}><RefreshCw size={16} className={loading ? "working" : ""} /></button></header>
    <p>沿用这台 Mac 已有的助手配置，选择后就会成为联系人。</p>
    {loading && <p role="status"><Loader2 size={15} className="working" />正在检查本机助手…</p>}
    {inventory?.agents.filter(a => a.installed).map(agent => {
      const contact = contacts.find(c => c.id === `agent_${agent.id}`);
      const added = Boolean(contact && contact.added !== false);
      const selectable = agent.execution.supported && ["codex", "claude", "pi"].includes(agent.id);
      return <label className="im-local-candidate" key={agent.id}>
        <input type="checkbox" data-testid={`im-local-select-${agent.id}`} checked={selected.includes(agent.id)} disabled={loading || busy || added || !selectable} onChange={e => { setSelected(previous => e.target.checked ? [...previous, agent.id] : previous.filter(id => id !== agent.id)); setResult([]); }} />
        <Avatar size="small" contact={{ kind: "agent", name: contact?.name || agent.name, color: contact?.color || "blue", avatarAgent: agent.id }} />
        <span className="im-local-copy"><strong>{contact?.name || agent.name}</strong><small>{contact ? availabilityText[contact.availability] : "状态待检查"}{agent.version ? ` · ${agent.version}` : ""}</small><small>{contact?.execution?.model || "模型尚未确认"}{contact?.execution?.thinking ? ` · ${contact.execution.thinking}` : ""}</small></span>
        {added && <span className="im-local-added"><Check size={13} />已添加</span>}
      </label>;
    })}
    {!loading && inventory && !inventory.agents.some(a => a.installed) && <p data-testid="im-local-empty">还没有找到已安装的助手。可以先安装常用助手，或连接自己的服务。</p>}
    {error && <p className="im-error" role="alert">{error}</p>}
    {result.length > 0 ? <div className="im-local-result" data-testid="im-local-result"><span><Check size={16} />已添加 {result.length} 位助手</span><button className="im-primary" data-testid="im-local-chat" disabled={busy} onClick={() => void open(result.find(c => c.availability === "ready") || result[0]!)}>打开聊天<ChevronRight size={15} /></button></div> : <button className="im-primary im-local-add" data-testid="im-local-add" disabled={loading || busy || !selected.length} onClick={() => void add()}>{busy ? "正在添加…" : selected.length ? `添加选中的 ${selected.length} 位` : "选择要添加的助手"}</button>}
    <footer><span>只添加联系人，不会发送消息或运行模型。</span><button className="im-text-button" disabled={busy} onClick={onConnect}>管理连接<ChevronRight size={13} /></button></footer>
  </section>;
}
