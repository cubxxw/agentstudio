import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronRight, Laptop, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { api } from "./api";
import { Avatar } from "./ContactAvatar";
import type { DiscoveredContact, HostDiscoveryResult } from "./discovery-types";
import "./host-discovery.css";

type Props = {
  onOpenContact: (contactId: string) => void | Promise<void>;
  onPrepareRoles: () => void;
  onConnect: () => void;
  refreshKey?: string | number;
};

const stateText = { configuration_detected: "已读取登录配置", login_required: "需要登录", unsupported: "暂不支持聊天", unknown: "状态待检查" };
const sampledTime = (value: string) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

function ExistingContact({ contact, disabled, opening, onOpen, statusLabel }: { contact: DiscoveredContact; disabled: boolean; opening: boolean; onOpen: () => void; statusLabel?: string }) {
  return <article className="im-discovery-contact" data-testid="im-discovery-contact" data-contact-id={contact.contactId}>
    <Avatar size="small" contact={{ kind: "agent", name: contact.name, color: contact.color, icon: contact.icon, avatarAgent: contact.localAgentId }} />
    <div className="im-discovery-contact-copy"><strong>{contact.name}</strong><span>{contact.providerName} · {statusLabel || (contact.source === "existing_connection" ? "沿用已有服务会话" : "本机已配置")}</span></div>
    <button className="im-discovery-open" data-testid={`im-discovery-open-${contact.contactId}`} disabled={disabled} onClick={onOpen} aria-label={`打开与${contact.name}的聊天`}>
      {opening ? <Loader2 size={15} className="working" /> : <>打开聊天<ChevronRight size={14} /></>}
    </button>
  </article>;
}

/** Discovery never starts a model. Role preparation opens the existing onboarding. */
export function HostDiscovery({ onOpenContact, onPrepareRoles, onConnect, refreshKey }: Props) {
  const [data, setData] = useState<HostDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [actionError, setActionError] = useState(""), [opening, setOpening] = useState("");
  const [revision, setRevision] = useState(0), [expanded, setExpanded] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void api<HostDiscoveryResult>("/host/discovery").then(result => { if (!cancelled) setData(result); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "暂时无法检查这台 Mac"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey, revision]);

  const openContact = async (contactId: string) => {
    if (opening || loading || error) return;
    setOpening(contactId); setActionError("");
    try { await onOpenContact(contactId); }
    catch (reason) { if (live.current) setActionError(reason instanceof Error ? reason.message : "暂时无法打开聊天"); }
    finally { if (live.current) setOpening(""); }
  };
  const suggestedIds = new Set(data?.recommendations.filter(item => item.kind === "open_contact").map(item => item.contactId));
  const suggested = data?.readyContacts.filter(contact => suggestedIds.has(contact.contactId)) || [];
  const remaining = data?.readyContacts.filter(contact => !suggestedIds.has(contact.contactId)) || [];
  const configured = data?.configuredContacts || [];
  const suggestedConfigured = configured.filter(contact => suggestedIds.has(contact.contactId));
  const remainingConfigured = configured.filter(contact => !suggestedIds.has(contact.contactId));
  const remainingCount = remaining.length + remainingConfigured.length;
  const disabled = loading || Boolean(error) || Boolean(opening);
  const row = (contact: DiscoveredContact, statusLabel?: string) => <ExistingContact key={contact.contactId} contact={contact} statusLabel={statusLabel} disabled={disabled} opening={opening === contact.contactId} onOpen={() => void openContact(contact.contactId)} />;
  const memory = data?.host.totalMemoryGiB;

  return <section className="im-host-discovery" data-testid="im-host-discovery" aria-label="这台 Mac 上发现的助手">
    <header className="im-discovery-heading"><div><Laptop size={16} /><h3>这台 Mac 上的助手</h3></div><button className="im-icon" data-testid="im-discovery-refresh" disabled={loading} onClick={() => setRevision(value => value + 1)} aria-label="重新检查本机助手"><RefreshCw size={15} className={loading ? "working" : ""} /></button></header>
    <p className="im-discovery-intro">使用已有伙伴，或让助手根据你的工作准备合适的角色。</p>
    {loading && !data && <p className="im-discovery-status" role="status"><Loader2 size={15} className="working" />正在检查本机配置…</p>}
    {error && <p className="im-discovery-error" role="alert">{error}<button className="im-text-button" data-testid="im-discovery-retry" onClick={() => setRevision(value => value + 1)}>重试检查</button></p>}
    {data && <>
      <div className="im-discovery-contacts">{suggested.map(contact => row(contact))}{expanded && remaining.map(contact => row(contact))}</div>
      {(suggestedConfigured.length > 0 || (expanded && remainingConfigured.length > 0)) && <div className="im-discovery-configured" data-testid="im-discovery-configured"><h4>已保存的连接</h4>{suggestedConfigured.map(contact => row(contact, contact.statusLabel))}{expanded && remainingConfigured.map(contact => row(contact, contact.statusLabel))}</div>}
      {!data.readyContacts.length && !configured.length && <p className="im-discovery-empty" data-testid="im-discovery-empty">{data.agents.length ? "找到了已安装的助手，还需要核对登录或模型配置。" : "尚未发现已配置的聊天助手。"}</p>}
      {remainingCount > 0 && <button className="im-text-button im-discovery-more" data-testid="im-discovery-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : `查看另外 ${remainingCount} 位助手`}</button>}
      {data.canPrepareRoles && <div className="im-discovery-prepare"><div><Sparkles size={16} /><div><strong>准备合适的伙伴</strong><p>选择助手和参考资料，测试后再给出角色建议。</p></div></div><button className="im-secondary" data-testid="im-discovery-prepare" onClick={onPrepareRoles} disabled={disabled}>开始准备<ChevronRight size={14} /></button></div>}
      <div className="im-discovery-footer"><span>{loading ? "正在检查…" : error ? "上次检查" : "检查于"} {sampledTime(data.sampledAt)}</span><button className="im-text-button" data-testid="im-discovery-connect" onClick={onConnect}>管理连接<ArrowUpRight size={12} /></button></div>
      <details className="im-discovery-details"><summary data-testid="im-discovery-details">查看发现依据和本机状态</summary>
        {data.agents.length > 0 && <ul>{data.agents.map(agent => <li key={agent.id}><strong>{agent.name}</strong><span>{stateText[agent.state]}{agent.version ? ` · ${agent.version}` : ""}</span></li>)}</ul>}
        <p>安装和登录配置不代表模型、账号额度或当前网络已经验证。准备角色时会测试所选助手。</p>
        {(configured.length > 0 || data.readyContacts.some(contact => contact.source === "existing_connection")) && <p>已保存的服务连接沿用原有会话；当前登录和投递能力会在发送时核对，这里不宣称账号已验证或服务历史已隔离。</p>}
        {data.excludedToolsCount > 0 && <p>{data.excludedToolsCount} 个工具连接保留在连接管理中；工具连接本身不作为聊天伙伴。</p>}
        <dl><div><dt>内存容量</dt><dd>{memory == null ? "未知" : `${memory} GiB`}</dd></div><div><dt>内存压力</dt><dd>未知</dd></div><div><dt>磁盘余量</dt><dd>{data.host.diskAvailableGiB == null ? "未知" : `${data.host.diskAvailableGiB} GiB`}</dd></div><div><dt>执行队列</dt><dd>{data.host.queueDepth == null ? "未知" : `${data.host.queueDepth} 项`}</dd></div></dl>
      </details>
    </>}
    {!loading && !data && <button className="im-text-button" data-testid="im-discovery-connect" onClick={onConnect}>管理连接<ArrowUpRight size={12} /></button>}
    {actionError && <p className="im-discovery-error" role="alert">{actionError}</p>}
  </section>;
}
