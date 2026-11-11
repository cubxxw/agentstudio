import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Clock3, Loader2, Pause, Play, Settings2 } from "lucide-react";
import { api, key, RequestError } from "./api";
import { Modal } from "./ConversationPanels";
import { Avatar, availabilityText } from "./MessengerDialogs";
import type { AgentControl, AgentGoal, AgentSchedule } from "./agent-control-types";
import type { Contact } from "./types";
import "./agent-profile.css";

type Settings = { goal: AgentGoal; scheduler: AgentSchedule };
const stateLabels: Record<AgentControl["state"], string> = {
  idle: "尚未安排", scheduled: "等待下次运行", queued: "已排队", running: "正在推进", blocked: "需要处理", paused: "已暂停", completed: "目标已完成",
};
const runLabels: Record<string, string> = { queued: "已排队", running: "运行中", needs_input: "等待你决定", verifying: "核验中", completed: "已完成", failed: "失败", cancelled: "已停止", blocked: "受阻", unknown: "状态待核对" };
const settingsOf = (control: AgentControl): Settings => ({ goal: { ...control.goal }, scheduler: { ...control.scheduler } });
const isVersionConflict = (error: unknown) => error instanceof RequestError && error.status === 409 && ["version_conflict", "conflict"].includes(error.code);
const describeError = (error: unknown) => error instanceof Error ? error.message : "暂时无法连接，当前编辑已保留。";
const formatDate = (value: string, timeZone?: string) => {
  try { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }); }
  catch { return new Date(value).toLocaleString("zh-CN"); }
};

export function AgentProfile({ contact, onClose, onEdit, onChanged, onOpenThread }: {
  contact: Contact; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void>; onOpenThread: (id: string) => void;
}) {
  const [control, setControl] = useState<AgentControl | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(contact.kind === "agent");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "pause" | "run" | "">("");
  const [conflict, setConflict] = useState(false);
  const dirtyRef = useRef(false), actionRef = useRef(false), mounted = useRef(true);
  const loadSequence = useRef(0);
  const saveRequest = useRef<{ signature: string; clientId: string } | null>(null);
  const runRequest = useRef<{ version: number; clientId: string } | null>(null);
  const dirty = Boolean(settings && control && JSON.stringify(settings) !== JSON.stringify(settingsOf(control)));
  dirtyRef.current = dirty;

  useEffect(() => {
    mounted.current = true;
    if (contact.kind !== "agent") { setLoading(false); return () => { mounted.current = false; }; }
    let disposed = false;
    const load = async (initial = false) => {
      if (actionRef.current) return;
      const sequence = ++loadSequence.current;
      try {
        const next = await api<AgentControl>(`/contacts/${contact.id}/control`);
        if (disposed || sequence !== loadSequence.current || actionRef.current) return;
        setControl(next);
        if (initial || (!dirtyRef.current && !actionRef.current)) { setSettings(settingsOf(next)); setVersion(next.version); }
        if (initial) setError("");
      } catch (error) { if (!disposed && initial) setError(describeError(error)); }
      finally { if (!disposed) setLoading(false); }
    };
    void load(true);
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => { disposed = true; mounted.current = false; clearInterval(timer); };
  }, [contact.id, contact.kind]);

  const reload = async () => {
    if (actionRef.current) return;
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    try {
      const next = await api<AgentControl>(`/contacts/${contact.id}/control`);
      if (!mounted.current || sequence !== loadSequence.current) return;
      setControl(next); setSettings(settingsOf(next)); setVersion(next.version); setConflict(false); setNotice("");
      saveRequest.current = null; runRequest.current = null;
    } catch (error) { if (mounted.current) setError(describeError(error)); }
    finally { if (mounted.current) setLoading(false); }
  };
  const change = (next: Settings) => { dirtyRef.current = true; setSettings(next); setNotice(""); };
  const save = async (next = settings, action: "save" | "pause" = "save") => {
    if (!next || version === null || actionRef.current) return;
    loadSequence.current += 1;
    actionRef.current = true; setBusy(action); setError(""); setNotice("");
    const fields = { version, ...next };
    const signature = JSON.stringify(fields);
    if (saveRequest.current?.signature !== signature) saveRequest.current = { signature, clientId: key() };
    try {
      const result = await api<AgentControl>(`/contacts/${contact.id}/control`, { ...fields, clientId: saveRequest.current.clientId });
      if (mounted.current) {
        dirtyRef.current = false; setControl(result); setSettings(settingsOf(result)); setVersion(result.version); setConflict(false);
        setNotice(action === "pause" ? "已暂停后续运行。" : "已保存。");
        saveRequest.current = null; runRequest.current = null;
      }
      await onChanged();
    } catch (error) { if (mounted.current) { setConflict(isVersionConflict(error)); setError(describeError(error)); } }
    finally { actionRef.current = false; if (mounted.current) setBusy(""); }
  };
  const run = async () => {
    if (!control || dirty || actionRef.current) return;
    loadSequence.current += 1;
    actionRef.current = true; setBusy("run"); setError(""); setNotice("");
    runRequest.current ||= { version: control.version, clientId: key() };
    try {
      const result = await api<{ control: AgentControl; threadId: string; runId: string }>(`/contacts/${contact.id}/run`, runRequest.current);
      if (mounted.current) {
        setControl(result.control); setSettings(settingsOf(result.control)); setVersion(result.control.version); runRequest.current = null;
        setNotice("已安排本次运行，进展会保存在这位 Agent 的私聊中。");
      }
      await onChanged();
    } catch (error) { if (mounted.current) { setConflict(isVersionConflict(error)); setError(describeError(error)); } }
    finally { actionRef.current = false; if (mounted.current) setBusy(""); }
  };

  return <Modal title={contact.kind === "agent" ? "Agent 设置" : "联系人信息"} onClose={onClose} className="im-dialog im-agent-dialog">
    <div className="im-agent-profile" data-testid="im-agent-profile" data-contact-id={contact.id}>
      <div className="im-agent-profile-identity"><Avatar contact={contact} size="large" /><div><h3>{contact.name}</h3><span>@{contact.handle}</span><small><i className={contact.availability === "ready" ? "im-online-dot" : "im-offline-dot"} />{availabilityText[contact.availability]}</small></div></div>
      {contact.description && <p className="im-agent-description">{contact.description}</p>}
      <button type="button" className="im-agent-basic" data-testid="im-agent-basic" onClick={onEdit}><Settings2 size={17} /><span>身份与基本设置<small>{contact.kind === "agent" ? `${contact.providerName || "助手"} · ${contact.execution?.model || "默认模型"}${contact.execution?.thinking ? ` · ${contact.execution.thinking}` : ""}` : "名称、简介与头像"}</small></span><ChevronRight size={16} /></button>
      {contact.kind === "human" ? <p className="im-field-hint">这位联系人保存在本机，尚未接入消息网络。</p> : <>
        {loading && !control && <p className="im-agent-loading" role="status"><Loader2 size={16} className="working" />正在读取目标与调度…</p>}
        {control && settings && <form className="im-form im-agent-control" data-testid="im-agent-control" onSubmit={event => { event.preventDefault(); void save(); }}>
          <section className="im-agent-section"><div className="im-agent-section-heading"><h3>当前目标</h3><span className={`im-agent-state ${control.state}`} data-testid="im-agent-state" role="status">{stateLabels[control.state]}</span></div>
            <label className="im-agent-field">希望这位 Agent 持续推进什么<textarea rows={4} required={settings.scheduler.enabled} maxLength={12000} placeholder="例如：整理这个项目的待办，每次推进一项并记录结果。" value={settings.goal.text} disabled={Boolean(busy)} data-testid="im-agent-goal" onChange={event => change({ ...settings, goal: { ...settings.goal, text: event.target.value, ...(!settings.goal.text.trim() && !control.goal.text.trim() && settings.goal.status === "paused" && event.target.value.trim() ? { status: "active" as const } : {}) } })} /></label>
            <label className="im-agent-field im-agent-goal-status">目标状态<select value={settings.goal.status} disabled={Boolean(busy)} data-testid="im-agent-goal-status" onChange={event => change({ ...settings, goal: { ...settings.goal, status: event.target.value as AgentGoal["status"] }, scheduler: { ...settings.scheduler, ...(event.target.value !== "active" ? { enabled: false } : {}) } })}><option value="active">进行中</option><option value="paused">已暂停</option><option value="completed">已完成</option></select></label>
            {(!control.supported || contact.availability !== "ready") && <p className="im-callout" data-testid="im-agent-unsupported">{control.unsupportedReason || contact.availabilityReason || (contact.availability !== "ready" ? "这位助手的连接或登录暂不可用。可以先保存目标。" : "这位助手暂不支持运行目标。可以先保存目标。")}</p>}
          </section>
          <section className="im-agent-section"><div className="im-agent-section-heading"><h3>运行安排</h3><label className="im-agent-switch"><input type="checkbox" checked={settings.scheduler.enabled} disabled={Boolean(busy) || ((!control.supported || contact.availability !== "ready") && !settings.scheduler.enabled)} data-testid="im-agent-schedule-enabled" onChange={event => change({ ...settings, scheduler: { ...settings.scheduler, enabled: event.target.checked }, goal: { ...settings.goal, ...(event.target.checked ? { status: "active" as const } : {}) } })} /><span>启用调度</span></label></div>
            <p className="im-field-hint">AgentRoom 运行且这台 Mac 唤醒时执行。退出应用或休眠期间不会运行。</p>
            {settings.scheduler.enabled && <div className="im-agent-schedule-fields">
              <label className="im-agent-field">运行方式<select value={settings.scheduler.mode} disabled={Boolean(busy) || !control.supported} data-testid="im-agent-schedule-mode" onChange={event => change({ ...settings, scheduler: { ...settings.scheduler, mode: event.target.value as AgentSchedule["mode"], intervalMinutes: event.target.value === "autonomous" ? Math.min(1440, settings.scheduler.intervalMinutes) : settings.scheduler.intervalMinutes } })}><option value="interval">固定间隔</option><option value="daily">每天定时</option><option value="autonomous" disabled={!control.autonomousSupported}>自主决定下一步{!control.autonomousSupported ? "（当前助手不支持）" : ""}</option></select></label>
              {settings.scheduler.mode === "daily" ? <div className="im-agent-field-row"><label className="im-agent-field">每天的时间<input type="time" required value={settings.scheduler.time} disabled={Boolean(busy)} data-testid="im-agent-schedule-time" onChange={event => change({ ...settings, scheduler: { ...settings.scheduler, time: event.target.value } })} /></label><label className="im-agent-field">时区<input required maxLength={80} value={settings.scheduler.timeZone} disabled={Boolean(busy)} placeholder="Asia/Shanghai" data-testid="im-agent-schedule-timezone" onChange={event => change({ ...settings, scheduler: { ...settings.scheduler, timeZone: event.target.value } })} /></label></div> : <label className="im-agent-field">{settings.scheduler.mode === "autonomous" ? "首次等待（分钟）" : "间隔（分钟）"}<input type="number" required min={15} max={settings.scheduler.mode === "autonomous" ? 1440 : 10080} step={1} value={settings.scheduler.intervalMinutes || ""} disabled={Boolean(busy)} data-testid="im-agent-schedule-interval" onChange={event => change({ ...settings, scheduler: { ...settings.scheduler, intervalMinutes: Number(event.target.value) } })} /></label>}
              {settings.scheduler.mode === "autonomous" && <p className="im-field-hint" data-testid="im-agent-autonomous-hint">首次运行后，由这位 Agent 决定继续、等待或完成目标。下次等待为 15 分钟至 24 小时，每日上限仍然生效。</p>}
              <label className="im-agent-field">每天最多运行<input type="number" required min={1} max={24} step={1} value={settings.scheduler.maxRunsPerDay || ""} disabled={Boolean(busy)} data-testid="im-agent-schedule-limit" onChange={event => change({ ...settings, scheduler: { ...settings.scheduler, maxRunsPerDay: Number(event.target.value) } })} /></label>
            </div>}
            <div className="im-agent-next" data-testid="im-agent-next-run"><Clock3 size={15} /><span>下一次<strong>{control.nextRunAt ? formatDate(control.nextRunAt, control.scheduler.timeZone) : control.state === "running" ? "本次运行后更新" : "尚无安排"}</strong></span><small>今天已运行 {control.runsToday} 次</small></div>
            {control.lastReason && <p className="im-field-hint" data-testid="im-agent-last-reason">{control.lastReason}</p>}
          </section>
          <div className="im-agent-actions"><button className="im-primary" type="submit" disabled={Boolean(busy) || !dirty || conflict} data-testid="im-agent-save">{busy === "save" ? <Loader2 size={16} className="working" /> : <Check size={16} />}{busy === "save" ? "正在保存…" : "保存设置"}</button><button className="im-secondary" type="button" disabled={Boolean(busy) || !control.supported || contact.availability !== "ready" || dirty || !control.goal.text.trim() || control.goal.status !== "active" || ["running", "queued"].includes(control.state) || conflict} data-testid="im-agent-run-now" onClick={() => void run()}>{busy === "run" ? <Loader2 size={15} className="working" /> : <Play size={15} />}立即运行</button>{control.goal.status === "active" && (control.scheduler.enabled || ["running", "queued", "scheduled"].includes(control.state)) && <button className="im-text-button" type="button" disabled={Boolean(busy) || dirty || conflict} data-testid="im-agent-pause" onClick={() => void save({ ...settings, goal: { ...settings.goal, status: "paused" }, scheduler: { ...settings.scheduler, enabled: false } }, "pause")}><Pause size={15} />暂停后续运行</button>}</div>
          {dirty && <p className="im-field-hint" data-testid="im-agent-unsaved">有未保存的更改。保存后才会应用到后续运行。</p>}
        </form>}
        {error && <div className="im-agent-error" role="alert" data-testid="im-agent-error"><p>{error}</p><button type="button" className="im-text-button" disabled={Boolean(busy) || loading} data-testid="im-agent-reload" onClick={() => void reload()}>{conflict ? "载入最新设置（替换当前编辑）" : control ? "重新读取已保存设置" : "重试读取"}</button></div>}
        {notice && <p className="im-agent-notice" role="status" data-testid="im-agent-notice"><Check size={15} />{notice}</p>}
        {control && <section className="im-agent-section im-agent-history" data-testid="im-agent-history"><h3>最近运行</h3>{control.recentRuns.length ? control.recentRuns.map(run => <div className="im-agent-history-item" key={run.runId} data-testid={`im-agent-run-${run.runId}`}><div><span>{runLabels[run.status] || run.status}</span><time dateTime={run.createdAt}>{formatDate(run.createdAt)}</time>{run.error && <p>{run.error}</p>}</div><button type="button" className="im-text-button" data-testid={`im-agent-run-open-${run.runId}`} onClick={() => onOpenThread(run.threadId)}>查看对话<ChevronRight size={14} /></button></div>) : <p className="im-field-hint">还没有运行记录。</p>}</section>}
      </>}
    </div>
  </Modal>;
}
