import { FileText, History } from "lucide-react";
import { DecisionView, Modal } from "./ConversationPanels";
import type { Artifact, Connection, Decision, Run, Thread } from "./types";

export const runText: Record<string, string> = { queued: "等待回复", running: "正在回复", verifying: "正在保存回复", needs_input: "等待审批", blocked: "需要处理", unknown: "结果待核查", failed: "未完成", cancelled: "已停止", completed: "已回复" };
export const runLabel = (run: Run) => run.cancelPending ? "正在确认停止" : run.requiresReconciliation || run.stopUnconfirmed ? "结果待核查" : runText[run.status];

export function ConversationDetails({ thread, connections, busy, onClose, onRead, onRun, onDecide }: {
  thread: Thread; connections: Connection[]; busy: string; onClose: () => void;
  onRead: (artifact: Artifact) => void; onRun: (run: Run, action: string) => void;
  onDecide: (decision: Decision, choice: string) => void;
}) {
  return <Modal title="聊天记录与成果" className="im-details-dialog" onClose={onClose}>
    <div className="im-conversation-details" data-testid="im-conversation-details">
      <section><h3><FileText size={17} />成果<span>{thread.artifacts.length}</span></h3>
        {thread.artifacts.length ? thread.artifacts.map((artifact, i) => <button key={artifact.id} className="im-result-row" data-testid="im-artifact" onClick={() => onRead(artifact)}><FileText size={21} /><span><strong>{artifact.title}</strong><small>第 {i + 1} 份 · {artifact.verifiedAt ? "文件已核验" : "尚未核验"} · {artifact.size.toLocaleString()} 字节</small></span></button>) : <p className="im-field-hint">这段聊天还没有保存成果。</p>}
      </section>
      <section><h3><History size={17} />执行记录<span>{thread.runs.length}</span></h3>
        {thread.runs.map(run => <div key={run.id} className="im-execution-record" data-testid="im-execution-record">
          <div className="im-execution-heading"><strong>{run.contactSnapshot?.name || (run.mode === "local" ? "本地整理" : run.mode === "connection" ? connections.find(c => c.id === run.connectionId)?.name || "原连接" : "本机助手")}</strong><span>{runLabel(run)}</span></div>
          <time>{new Date(run.createdAt).toLocaleString("zh-CN")}</time>
          {run.error && <p className="im-error">{run.error}</p>}
          {["queued", "running", "verifying", "needs_input"].includes(run.status) && <button className="im-text-button" disabled={busy === run.id} onClick={() => onRun(run, "cancel")}>停止这次执行</button>}
          {["blocked", "failed", "unknown"].includes(run.status) && <button className="im-text-button" disabled={busy === run.id} onClick={() => onRun(run, run.status === "unknown" || run.externalTaskId ? "reconcile" : "retry")}>{run.status === "unknown" || run.externalTaskId ? "核查原任务" : "重试这次执行"}</button>}
          {run.status === "cancelled" && run.externalTaskId && <button className="im-text-button" disabled={busy === run.id} onClick={() => onRun(run, "reconcile")}>核查原任务</button>}
          <details><summary>执行详情</summary>{run.routingReason && <p>{run.routingReason}</p>}{run.externalTaskId && <p>任务编号：{run.externalTaskId}</p>}{run.remoteReceipt !== undefined && <><h4>原始回执</h4><pre tabIndex={0}>{JSON.stringify(run.remoteReceipt, null, 2)}</pre></>}{run.externalVerification !== undefined && <><h4>核验范围</h4><pre tabIndex={0}>{JSON.stringify(run.externalVerification, null, 2)}</pre></>}</details>
        </div>)}
        {!thread.runs.length && <p className="im-field-hint">还没有执行记录。</p>}
      </section>
      {thread.decisions.length > 0 && <section><h3>审批记录</h3>{thread.decisions.map(decision => <DecisionView key={decision.id} decision={decision} busy={busy === decision.id} onDecide={choice => onDecide(decision, choice)} />)}</section>}
      {thread.events.length > 0 && <section><h3>会话进展</h3><ol className="event-list">{thread.events.map(event => <li key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><span>{event.text}</span></li>)}</ol></section>}
    </div>
  </Modal>;
}
