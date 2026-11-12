import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { api, key } from "./api";
import { Modal } from "./ConversationPanels";
import { AgentOptions } from "./AgentOptions";
import { Avatar } from "./ContactAvatar";
import { desktopBridge } from "./native";
import type { AgentConfiguration, Contact, OnboardingContext, OnboardingJob, OnboardingSource } from "./types";

const running = (job: OnboardingJob | null) => Boolean(job && (job.cancelPending || ["queued", "probing", "analyzing"].includes(job.status)));
const labels: Record<OnboardingJob["status"], string> = { queued: "正在排队", probing: "正在测试助手能否实际运行", analyzing: "正在结合现有伙伴和群聊准备建议", completed: "角色建议已准备好", failed: "这次准备未完成", interrupted: "上次准备已中断", cancelled: "已取消准备" };
const savedRequest = () => { try { return JSON.parse(localStorage.getItem("agentstudio.onboarding.request") || "null") as { signature: string; clientId: string } | null; } catch { return null; } };

export function AgentOnboarding({ contacts, onClose, onAdopted, onRefresh }: { contacts: Contact[]; onClose: () => void; onAdopted: (contact: Contact) => Promise<void>; onRefresh: () => Promise<void> }) {
  const agents = contacts.filter(c => c.discovered && c.kind === "agent" && c.binding?.type === "local");
  const preferred = agents.find(c => c.binding?.type === "local" && c.binding.localAgentId === "codex" && c.availability === "ready") || agents.find(c => c.availability === "ready") || agents[0];
  const [agentId, setAgentId] = useState(preferred?.id || "");
  const selected = agents.find(c => c.id === agentId);
  const [configuration, setConfiguration] = useState<AgentConfiguration>({ modelMode: "follow", thinking: "follow" });
  const [context, setContext] = useState<OnboardingContext | null>(null), [job, setJob] = useState<OnboardingJob | null>(null);
  const [goal, setGoal] = useState(() => { try { return localStorage.getItem("agentstudio.onboarding.goal") || ""; } catch { return ""; } });
  const [recent, setRecent] = useState(true), [memories, setMemories] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const request = useRef(savedRequest()), adopting = useRef(new Map<string, string>());
  const inflight = useRef(false), live = useRef(true);
  useEffect(() => {
    live.current = true;
    void Promise.all([api<OnboardingContext>("/agent-onboarding/context"), api<{ jobs: OnboardingJob[] }>("/agent-onboarding")]).then(([sources, history]) => {
      if (!live.current) return; setContext(sources); setJob(history.jobs[0] || null);
    }).catch(e => { if (live.current) setError(e instanceof Error ? e.message : "无法读取工作区"); }).finally(() => { if (live.current) setLoading(false); });
    return () => { live.current = false; };
  }, []);
  useEffect(() => {
    if (!job || !running(job)) return;
    let stopped = false;
    const update = async () => {
      if (inflight.current || stopped) return;
      inflight.current = true;
      try { const next = await api<OnboardingJob>(`/agent-onboarding/${job.id}`); if (!stopped) { setJob(next); setError(""); } }
      catch (e) { if (!stopped) setError(e instanceof Error ? e.message : "连接中断，准备记录仍保留"); }
      finally { inflight.current = false; }
    };
    const timer = window.setInterval(() => void update(), 1500);
    const unsubscribe = desktopBridge()?.onChanged(() => void update());
    return () => { stopped = true; window.clearInterval(timer); unsubscribe?.(); };
  }, [job?.id, job?.status, job?.cancelPending]);
  const start = async () => {
    if (selected?.binding?.type !== "local") return;
    setBusy("start"); setError("");
    const fields = { agentId: selected.binding.localAgentId, configuration, goal, includeRecentMessages: recent, includeMemories: memories };
    const signature = JSON.stringify(fields);
    if (request.current?.signature !== signature) request.current = { signature, clientId: key() };
    try { localStorage.setItem("agentstudio.onboarding.request", JSON.stringify(request.current)); } catch { /* The current mounted request still remains stable. */ }
    try {
      const result = await api<OnboardingJob>("/agent-onboarding", { ...fields, clientId: request.current.clientId });
      if (live.current) setJob(result);
      request.current = null; try { localStorage.removeItem("agentstudio.onboarding.request"); } catch { /* Persisted replay remains safe. */ }
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : "准备尚未开始，重试会核对原请求"); }
    finally { if (live.current) setBusy(""); }
  };
  const sourceList = (ids: string[]) => <ul className="im-onboarding-sources">{ids.map(sourceId => { const source = job?.sources.find(s => s.id === sourceId); return <li key={sourceId}>{source?.kind === "message" ? "群聊片段" : source?.kind === "memory" ? "已保存的记忆" : source?.kind === "role" ? "现有角色" : "现有群聊"} · {source?.label}<small>{source?.text || source?.description}</small></li>; })}</ul>;
  const active = running(job), shownSources = context?.sources.filter(s => s.kind === "group" || s.kind === "role").slice(0, 12) || [];
  return <Modal title="让助手建议角色" className="im-dialog im-onboarding-dialog" onClose={onClose}>
    <div className="im-form" data-testid="im-onboarding">
      <div className="im-onboarding-intro"><span className="im-onboarding-mark"><Sparkles size={23} /></span><div><h2>先认识你的工作，再准备合适的伙伴。</h2><p>先测试助手能否实际运行，再参考已有角色和群聊提出建议。选用后才会创建联系人。</p></div></div>
      {loading && <p role="status">正在读取工作区…</p>}
      {!active && (job?.status !== "completed" || editing) && <>
        <label>让哪个助手准备<select data-testid="im-onboarding-agent" value={agentId} disabled={Boolean(busy)} onChange={e => { setAgentId(e.target.value); setConfiguration({ modelMode: "follow", thinking: "follow" }); }}>{!agents.length && <option value="">请先连接本机助手</option>}{agents.map(c => <option key={c.id} value={c.id} disabled={c.availability !== "ready" && c.availability !== "configuration_required"}>{c.name} · {c.execution?.model || c.profile?.defaults.model || "需要配置"}</option>)}</select></label>
        <AgentOptions profile={selected?.profile} value={configuration} onChange={setConfiguration} refreshing={busy === "refresh"} onRefresh={() => { setBusy("refresh"); void onRefresh().catch(e => setError(String(e))).finally(() => setBusy("")); }} />
        <label>希望伙伴帮你做什么？<textarea data-testid="im-onboarding-goal" maxLength={1500} rows={2} placeholder="可选，例如：一起讨论产品，并在发布前做独立审查。" value={goal} onChange={e => { setGoal(e.target.value); try { localStorage.setItem("agentstudio.onboarding.goal", e.target.value); } catch { /* Keep the live draft. */ } }} /></label>
        <details className="im-onboarding-context"><summary data-testid="im-onboarding-context">参考当前工作区<span>{context?.counts.roles || 0} 个角色 · {context?.counts.groups || 0} 个群聊</span></summary><p>只使用这份个人工作区的资料，不读取其他项目、终端历史或私聊。</p><label><input type="checkbox" data-testid="im-onboarding-recent" checked={recent} onChange={e => setRecent(e.target.checked)} />参考群聊中近期由你发送的文字</label><label><input type="checkbox" data-testid="im-onboarding-memories" checked={memories} onChange={e => setMemories(e.target.checked)} />参考已保存的记忆</label><ul>{shownSources.map((s: OnboardingSource) => <li key={s.id}>{s.kind === "role" ? "角色" : "群聊"} · {s.label}</li>)}</ul><p>内容较多时使用有上限的摘录；习惯判断会作为推断注明来源。</p></details>
      </>}
      {job && <section className="im-onboarding-result" data-testid="im-onboarding-result">
        <div className="im-onboarding-status" role="status" aria-live="polite">{active ? <Loader2 size={18} className="working" /> : job.probe.status === "passed" ? <Check size={18} /> : null}<strong data-testid="im-onboarding-status">{job.cancelPending ? "正在确认助手停止" : labels[job.status]}</strong></div>
        <p className="im-field-hint">{job.executionSnapshot.model} · {job.executionSnapshot.thinking || "默认深度"}{job.probe.status === "passed" ? " · 实际运行测试已通过" : " · 安装和登录状态不代表运行测试通过"}</p>
        {active && <button className="im-text-button" data-testid="im-onboarding-cancel" disabled={Boolean(busy) || job.cancelPending} onClick={() => { setBusy("cancel"); void api<OnboardingJob>(`/agent-onboarding/${job.id}/cancel`, { clientId: key() }).then(setJob).catch(e => setError(String(e))).finally(() => setBusy("")); }}>停止这次准备</button>}
        {job.error && <p className="im-error" role="alert">{job.error}</p>}
        {job.habits.length > 0 && <details><summary>从已有资料推测的习惯</summary>{job.habits.map((h, i) => <div key={i}><p>推断：{h.text}</p>{sourceList(h.sourceIds)}</div>)}</details>}
        {job.suggestions.map(s => <article className="im-role-suggestion" key={s.id} data-testid="im-role-suggestion"><div className="im-role-heading"><Avatar contact={{ name: s.name, color: s.color, avatar: s.avatar, kind: "agent", binding: { type: "local", localAgentId: job.agentId } }} /><div><h3>{s.name}</h3><span>@{s.handle}</span></div></div><p>{s.description}</p><p className="im-role-rationale">{s.rationale}</p>{s.groupIds.length > 0 && <p className="im-field-hint">可以参与：{s.groupIds.map(groupId => job.sources.find(source => source.kind === "group" && source.targetId === groupId)?.label).filter(Boolean).join("、")}。采用后可自行加群。</p>}<details><summary>查看身份指令和依据</summary><p className="im-role-instructions">{s.instructions}</p>{sourceList(s.sourceIds)}</details><button className="im-secondary" data-testid="im-adopt-role" disabled={Boolean(busy) || Boolean(s.contactId)} onClick={() => {
          const id = adopting.current.get(s.id) || key(); adopting.current.set(s.id, id); setBusy(s.id); setError("");
          void api<Contact>(`/agent-onboarding/${job.id}/adopt`, { suggestionId: s.id, clientId: id }).then(async contact => { if (live.current) setJob(current => current && { ...current, suggestions: current.suggestions.map(item => item.id === s.id ? { ...item, contactId: contact.id } : item) }); await onAdopted(contact); }).catch(e => { if (live.current) setError(e instanceof Error ? e.message : "角色尚未创建"); }).finally(() => { if (live.current) setBusy(""); });
        }}>{s.contactId ? <><Check size={15} />已添加到联系人</> : busy === s.id ? "正在添加…" : <>采用这个角色<ChevronRight size={15} /></>}</button></article>)}
        {(job.truncation.omitted > 0 || job.truncation.clipped > 0) && <p className="im-field-hint">本次使用有上限的摘录，{job.truncation.omitted} 项来源未包含，{job.truncation.clipped} 处使用节选。</p>}
      </section>}
      {error && <p className="im-error" role="alert">{error}</p>}
      {!active && <button className="im-primary" data-testid="im-onboarding-start" disabled={Boolean(busy) || loading || !selected || !["ready", "configuration_required"].includes(selected.availability)} onClick={() => { if (job?.status === "completed" && !editing) setEditing(true); else void start(); }}>{busy === "start" ? "正在开始…" : job?.status === "completed" && !editing ? "调整目标或模型" : job ? "重新测试并准备建议" : "测试助手并准备建议"}</button>}
      <p className="im-field-hint">使用当前助手的模型与账号，会产生两次模型调用。关闭窗口后仍可回来查看进度和建议。</p>
    </div>
  </Modal>;
}
