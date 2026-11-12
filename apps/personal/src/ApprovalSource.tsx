import { ChevronRight } from "lucide-react";
import { Avatar } from "./ContactAvatar";
import type { Approval, Contact } from "./types";

export function ApprovalRow({ approval, contact, selected, onSelect }: { approval: Approval; contact?: Contact; selected: boolean; onSelect: () => void }) {
  const states: Record<string, string> = { pending: "等待决定", sending: "正在同步选择", unknown: "结果待核查", cancelled: "已失效" };
  const state = states[approval.state] || "已记录选择";
  return <button className={`im-chat-row im-approval-row ${selected ? "selected" : ""}`} data-testid={`im-approval-${approval.id}`} onClick={onSelect}>
    <Avatar contact={contact} />
    <span className="im-row-copy">
      <span className="im-approval-by"><span>{contact?.name || "未关联联系人"}</span><small>{state}</small></span>
      <strong>{approval.title}</strong>
      <small>{approval.source?.label || "来源待核对"}{approval.source?.botId ? ` · ${approval.source.botId}` : contact?.handle ? ` · @${contact.handle}` : ""}{approval.source?.threadKind === "group" ? ` · ${approval.threadTitle}` : ""}</small>
    </span>
  </button>;
}

export function ApprovalSource({ approval, contact, canOpenContact, onContact, onChat }: { approval: Approval; contact?: Contact; canOpenContact: boolean; onContact: () => void; onChat: () => void }) {
  const original = approval.contact;
  const kind = approval.source?.threadKind === "group" ? "群聊" : approval.source?.threadKind === "direct" ? "私聊" : "任务对话";
  return <section className="im-approval-source" data-testid="im-approval-source" aria-label="审批来源">
    <div className="im-approval-sender">
      <Avatar contact={contact} size="large" />
      <div><span className="im-muted">请求来自</span><h2>{canOpenContact ? <button data-testid="im-approval-contact" onClick={onContact}>{contact?.name}<ChevronRight size={17} /></button> : contact?.name || "未关联联系人"}</h2>
        {contact?.handle && <p>@{contact.handle}</p>}
        {original && contact?.name !== original.name && <p>发起时：{original.name}</p>}
      </div>
    </div>
    <dl>
      <div><dt>Bot / 助手</dt><dd>{approval.source?.label || "来源待核对"}{approval.source?.name && approval.source.name !== approval.source.label && <span> · {approval.source.name}</span>}{approval.source?.botId && <small>Bot ID：<code>{approval.source.botId}</code></small>}</dd></div>
      <div><dt>原聊天</dt><dd><button className="im-text-button" data-testid="im-approval-source-chat" onClick={onChat}>{kind} · {approval.threadTitle}<ChevronRight size={15} /></button></dd></div>
      <div><dt>相关请求</dt><dd>{approval.source?.requestText ? <p className="im-approval-request">{approval.source.requestText}</p> : <span className="im-muted">{approval.source?.botId ? "这张卡来自原服务，未关联本机发送的消息。" : "未保留关联的请求消息，可回到原聊天核对。"}</span>}</dd></div>
    </dl>
  </section>;
}
