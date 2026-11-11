import { Check, Clock3, Copy, FileText, Reply, Square } from "lucide-react";
import { Avatar } from "./ContactAvatar";
import { runLabel } from "./ConversationDetails";
import { conversationRows } from "./conversation-rows";
import { RichText } from "./Markdown";
import type { Artifact, Attachment, Contact, Message, Run, Thread } from "./types";

const time = (value: string) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
const date = (value: string) => new Date(value).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
export function ConversationTimeline({ thread, contacts, limit, onMore, onReply, onContact, onSource, onRead, onRun, onError, busy }: {
  thread: Thread; contacts: Contact[]; limit: number; onMore: () => void; onReply: (message: Message) => void;
  onContact: (id: string) => void; onSource: (source: Attachment) => void; onRead: (artifact: Artifact) => void;
  onRun: (run: Run, action: string) => void; onError: (error: string) => void; busy: string;
}) {
  const allRows = conversationRows(thread), rows = allRows.slice(-limit * 2);
  const bubble = (message: Message, run?: Run, preview = false) => {
    if (message.role === "system") return <div className="im-schedule-event" data-testid="im-schedule-event"><Clock3 size={13} /><RichText text={message.text} /></div>;
    const sender = message.contactSnapshot || contacts.find(contact => contact.id === message.contactId);
    const reply = message.replyTo ? thread.messages.find(item => item.id === message.replyTo) : null;
    const queued = message.role === "user" && thread.runs.some(item => item.messageId === message.id && item.status === "queued");
    return <article className={`im-message ${message.role === "user" ? "outgoing" : "incoming"} ${preview ? "im-streaming" : ""}`} data-testid={preview ? "im-streaming-message" : "im-message"} data-contact-id={message.contactId} data-message-id={message.id}>
      {message.role !== "user" && <Avatar contact={sender} size="small" />}
      <div className="im-bubble">
        {message.role !== "user" && <button className="im-sender" onClick={() => sender && onContact(sender.id)}>{sender?.name || "助手"}</button>}
        {reply && <div className="im-reply-quote"><span>{reply.role === "user" ? "你" : reply.contactSnapshot?.name || "助手"}</span>{reply.text.slice(0, 120)}</div>}
        <RichText text={message.text} onSource={sourceId => { const found = thread.messages.flatMap(item => item.attachments || []).find(source => source.id === sourceId); if (found) onSource(found); else onError("找不到这处引用的原始资料"); }} />
        {message.attachments?.map((source, i) => <button className="im-attachment" key={source.id || i} onClick={() => onSource(source)}><FileText size={17} />{source.name}</button>)}
        {message.skippedContacts?.map(contact => <p className="im-field-hint" key={contact.id}>{contact.name} 未参与回复：{contact.reason}</p>)}
        <div className="im-message-meta" data-testid="im-message-meta">{message.artifactId && <button data-testid="im-open-artifact" onClick={() => { const artifact = thread.artifacts.find(item => item.id === message.artifactId); if (artifact) onRead(artifact); }}>打开原文</button>}{run?.executionSnapshot?.model && <span className="im-message-model" title={`${run.executionSnapshot.provider || ""} · ${run.executionSnapshot.thinking || "默认深度"}`}>{run.executionSnapshot.model}</span>}{preview ? !["running", "verifying"].includes(run?.status || "") && <span>未完成的回复</span> : <time>{time(message.createdAt)}</time>}{message.role === "user" && <span title={message.deliveryState === "local_only" ? "仅保存在本机，对方未收到" : "已保存到本机"}>{queued ? "已排队" : <Check size={12} />}{message.deliveryState === "local_only" && "仅本机"}</span>}</div>
      </div>
      {!preview && <div className="im-message-actions" data-testid="im-message-actions"><button className="im-icon" aria-label="回复这条消息" data-testid="im-reply-message" onClick={() => onReply(message)}><Reply size={15} /></button><button className="im-icon" aria-label="复制消息" onClick={() => void navigator.clipboard.writeText(message.text).catch(() => onError("暂时无法复制，请选中文字复制"))}><Copy size={14} /></button></div>}
    </article>;
  };
  return <>
    {allRows.length > rows.length && <button className="im-load-more" onClick={onMore}>查看更早的消息</button>}
    {rows.map((row, i) => {
      const at = row.type === "message" ? row.message.createdAt : row.run.createdAt;
      const previous = rows[i - 1]; const previousAt = previous?.type === "message" ? previous.message.createdAt : previous?.run.createdAt;
      return <div key={row.id} className="im-message-group" data-testid={row.type === "reply" ? `im-response-${row.id}` : undefined}>
        {(!previousAt || date(at) !== date(previousAt)) && <div className="im-date"><span>{date(at)}</span></div>}
        {row.type === "message" ? bubble(row.message) : <>
          {row.messages.map(message => <div key={message.id}>{bubble(message, row.run)}</div>)}
          {!row.messages.length && row.run.progress?.text && bubble({ id: `preview-${row.run.id}`, text: row.run.progress.text, role: "assistant", createdAt: row.run.startedAt || row.run.createdAt, contactId: row.run.contactId, contactSnapshot: row.run.contactSnapshot }, row.run, true)}
          {row.run.status !== "completed" && <div className={`im-reply-state ${row.run.status === "queued" ? "queued" : ""} ${["blocked", "failed", "unknown", "cancelled"].includes(row.run.status) ? "attention" : ""}`} data-testid="im-run-status" data-run-id={row.run.id}>
            {!row.messages.length && !row.run.progress?.text && <Avatar contact={row.run.contactSnapshot} size="small" />}
            <div role="status" aria-live="polite"><span className="im-reply-label">{["running", "verifying"].includes(row.run.status) ? <><span className="im-typing-dots" aria-hidden="true"><i /><i /><i /></span>{row.run.progress?.phase === "thinking" ? "正在思考" : row.run.progress?.text ? "正在回复" : row.run.status === "verifying" ? "正在保存回复" : "正在准备回复"}</> : row.run.status === "queued" ? "已排队，接着上一条回复继续" : runLabel(row.run)}</span>{row.run.error && <p>{row.run.error}</p>}</div>
            {["running", "queued", "verifying", "needs_input"].includes(row.run.status) ? <button className="im-icon" aria-label={`停止${row.run.contactSnapshot?.name || "助手"}`} data-testid={`im-run-stop-${row.run.id}`} disabled={busy === row.run.id} onClick={() => onRun(row.run, "cancel")}><Square size={13} /></button> : ["blocked", "failed", "unknown"].includes(row.run.status) || row.run.requiresReconciliation ? <button className="im-text-button" disabled={busy === row.run.id} onClick={() => onRun(row.run, row.run.status === "unknown" || row.run.externalTaskId ? "reconcile" : "retry")}>{row.run.status === "unknown" || row.run.externalTaskId ? "核查原任务" : "重试"}</button> : null}
          </div>}
        </>}
      </div>;
    })}
  </>;
}
