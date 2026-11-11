import { useRef, useState } from "react";
import { Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { api, key } from "./api";
import type { RemoteNode } from "./types";

export function RemoteNodes({ nodes, onRefresh }: { nodes: RemoteNode[]; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [url, setUrl] = useState(""), [token, setToken] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const requestId = useRef(key()), pending = useRef(false);
  const perform = async (name: string, work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(name); setError(""); setNotice("");
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : "暂时没有连上，请检查节点服务。"); }
    finally { await onRefresh().catch(() => {}); pending.current = false; setBusy(""); }
  };
  const reset = () => { setOpen(false); setToken(""); setUrl(""); requestId.current = key(); };
  return <section className="integration-section" aria-labelledby="connections-nodes-title" data-testid="personal-remote-nodes">
    <div className="integration-section-heading"><h3 id="connections-nodes-title">其他服务器</h3><button className="text-button" disabled={Boolean(busy)} data-testid="personal-node-add" onClick={() => setOpen(true)}><Plus size={14} />添加服务器</button></div>
    <p className="integration-intro">把 Tailscale 中服务器上的助手加入联系人，继续在这里私聊或邀请进群。</p>
    {nodes.map(node => <div key={node.id} data-testid="personal-node-row">
      <div className="integration-row"><div className="integration-symbol" aria-hidden="true"><Server size={19} /></div><div className="integration-copy"><strong>{node.name}</strong><p>{new URL(node.origin).host}</p>
        <p>{node.status === "reachable" ? "上次检查可连接" : "上次检查未连接"}{node.checkedAt && ` · ${new Date(node.checkedAt).toLocaleString("zh-CN")}`}</p></div>
        <div className="integration-actions"><button className="integration-button" data-testid="personal-node-check" disabled={Boolean(busy)} onClick={() => void perform(node.id, async () => { await api(`/nodes/${node.id}/check`, {}); setNotice("节点已响应。账号和额度以实际任务执行为准。"); })}><RefreshCw size={14} />{busy === node.id ? "检查中…" : "检查连接"}</button></div></div>
      {node.agents.map(agent => <div className="integration-instance" key={agent.id}><div><strong>{agent.name}</strong><p>{agent.availability === "configured" ? "远端登录已配置" : agent.availability === "not_installed" ? "远端尚未安装" : agent.availability === "login_required" ? "需要在服务器登录" : agent.availability === "withdrawn" ? "节点已停用此助手，可移除原连接" : "远端状态待检查"}</p></div>
        <button className="icon-button" aria-label={`移除 ${agent.name} · ${node.name}`} disabled={Boolean(busy)} data-testid="personal-node-agent-remove" onClick={() => void perform(agent.connectionId, async () => { await api(`/connections/${agent.connectionId}`, undefined, "DELETE"); })}><Trash2 size={16} /></button></div>)}
    </div>)}
    {open && <form className="connection-form" data-testid="personal-node-form" onSubmit={event => { event.preventDefault(); void perform("connect", async () => {
      await api("/nodes/connect", { url, token, clientId: requestId.current }); reset(); setNotice("服务器已加入，助手已出现在联系人中。");
    }); }}>
      <label>节点地址<input type="url" required value={url} disabled={Boolean(busy)} placeholder="https://server.tailnet.ts.net:19443" data-testid="personal-node-url" onChange={e => { setUrl(e.target.value); requestId.current = key(); }} /></label>
      <label>节点访问令牌<input type="password" required autoComplete="new-password" spellCheck={false} value={token} maxLength={512} disabled={Boolean(busy)} data-testid="personal-node-token" onChange={e => { setToken(e.target.value); requestId.current = key(); }} /></label>
      <p className="field-help">地址和令牌由服务器上的 AgentRoom 节点提供。一次添加该节点开放的助手，凭据只保存在本机加密库中。</p>
      <div className="form-actions"><button className="text-button" type="button" disabled={Boolean(busy)} onClick={reset}>取消</button><button className="integration-button" disabled={Boolean(busy)} data-testid="personal-node-save">{busy === "connect" ? "正在连接…" : "添加服务器"}</button></div>
    </form>}
    <p className="integration-note">服务器使用自己的登录与权限。Mac 离线时远端已接收的任务可继续，回复会在重新连接并核查后读回。</p>
    {notice && <p className="integration-notice" role="status">{notice}</p>}
    {error && <p className="error-text" role="alert" data-testid="personal-node-error">{error}</p>}
  </section>;
}
