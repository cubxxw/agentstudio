import { useRef, useState } from "react";
import { ArrowRight, FlaskConical, MessageCircle, RotateCcw, Settings2, Sparkles } from "lucide-react";
import { api, key } from "./api";
import { desktopBridge } from "./native";
import { Avatar } from "./ContactAvatar";
import type { Bootstrap, Contact } from "./types";

export function WorkspaceWelcome({ data, contacts, onContinue, onStartContact }: { data: Bootstrap; contacts: Contact[]; onContinue: (next: "chat" | "agents" | "connect") => Promise<void>; onStartContact: (contact: Contact) => Promise<void> }) {
  const [name, setName] = useState(data.workspace?.displayName === "你" ? "" : data.workspace?.displayName || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<{ name: string; clientId: string } | null>(null);
  const complete = async (next: "chat" | "agents" | "connect", contact?: Contact) => {
    if (busy) return;
    setBusy(true); setError("");
    const displayName = name.trim() || "你";
    if (pending.current?.name !== displayName) pending.current = { name: displayName, clientId: key() };
    try { await api("/workspace/onboarding", { action: "complete", ...pending.current }); if (contact) await onStartContact(contact); else await onContinue(next); }
    catch (e) { setError(e instanceof Error ? e.message : "引导尚未保存，请重试"); }
    finally { setBusy(false); }
  };
  return <section className="workspace-welcome" data-testid="workspace-welcome">
    <div className="workspace-mark" aria-hidden="true"><MessageCircle size={32} strokeWidth={1.5} /></div>
    <span className="im-welcome-brand">AgentRoom</span>
    <h2>你的伙伴，都在这里。</h2>
    <p>找一位 Agent 聊聊，或把几个伙伴拉进群里，一起把事情办好。</p>
    <form onSubmit={event => { event.preventDefault(); void complete("chat"); }}>
      <label htmlFor="workspace-owner-name">怎么称呼你？<input id="workspace-owner-name" data-testid="workspace-owner-name" value={name} maxLength={80} placeholder="你的名字（选填）" autoComplete="nickname" onChange={event => setName(event.target.value)} disabled={busy} /></label>
      <button className="im-primary" data-testid="im-welcome-start" disabled={busy}>{busy ? "正在保存…" : <>开始聊天<ArrowRight size={17} /></>}</button>
    </form>
    <div className="workspace-welcome-options">
      <button disabled={busy} data-testid="workspace-welcome-agents" onClick={() => void complete("agents")}><Sparkles size={17} />让助手建议角色</button>
      <button disabled={busy} data-testid="workspace-welcome-connect" onClick={() => void complete("connect")}><Settings2 size={17} />先连接助手</button>
    </div>
    {contacts.some(contact => contact.kind === "agent" && contact.availability === "ready") && <div className="workspace-quick"><span>也可以直接找已连接的伙伴</span><div>{contacts.filter(contact => contact.kind === "agent" && contact.availability === "ready").slice(0, 3).map(contact => <button disabled={busy} key={contact.id} data-testid={`im-quick-${contact.id}`} onClick={() => void complete("chat", contact)}><Avatar contact={contact} size="small" />{contact.name}</button>)}</div></div>}
    <small>聊天保存在这台 Mac。连接助手后，选定的对话会交给相应模型处理。</small>
    {error && <p className="im-error" role="alert">{error}</p>}
  </section>;
}

export function WorkspaceTools({ onRefresh, onWelcome }: { onRefresh: () => Promise<void>; onWelcome?: () => void }) {
  const desktop = desktopBridge();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const perform = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "操作尚未完成，请重试"); }
    finally { setBusy(false); }
  };
  return <div className="workspace-tools" data-testid="workspace-tools">
    <h3><RotateCcw size={18} />重新查看引导</h3>
    <p>重新选择如何开始，现有聊天、联系人和连接都会保留。</p>
    <button className="secondary-button" data-testid="workspace-reopen-welcome" disabled={busy} onClick={() => void perform(async () => { await api("/workspace/onboarding", { action: "restart", clientId: key() }); await onRefresh(); onWelcome?.(); })}>重新查看引导</button>
    <hr />
    <h3><FlaskConical size={18} />{desktop?.testMode ? "当前处于测试模式" : "独立测试模式"}</h3>
    <p>使用空白资料反复体验首次使用、连接助手和创建角色。测试工作区的聊天、联系人、应用登录和草稿与原工作区分开。</p>
    <p>清空后会打开全新的测试身份并重新引导；旧测试资料留作恢复。本机 Codex、Claude 等 CLI 登录仍然沿用，测试中运行助手也会使用其已有权限和额度。</p>
    {desktop?.testWorkspace ? <div className="workspace-tool-actions">
      {desktop.testMode ? <>
        <button className="primary-button" data-testid="workspace-reset-test" disabled={busy} onClick={() => void perform(() => desktop.testWorkspace!("reset"))}>清空测试资料并重新引导</button>
        <button className="secondary-button" data-testid="workspace-leave-test" disabled={busy} onClick={() => void perform(() => desktop.testWorkspace!("leave"))}>返回我的工作区</button>
      </> : <button className="primary-button" data-testid="workspace-enter-test" disabled={busy} onClick={() => void perform(() => desktop.testWorkspace!("enter"))}>进入测试模式</button>}
    </div> : <p className="integration-note">请在 AgentRoom Mac 应用中使用独立测试模式。</p>}
    {busy && <p role="status">正在处理，请稍候…</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </div>;
}
