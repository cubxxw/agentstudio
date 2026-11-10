import type { Message, Run, Thread } from "./types";
export type ConversationRow = { id: string; type: "message"; message: Message } | { id: string; type: "reply"; run: Run; messages: Message[] };
export function conversationRows(thread: Thread): ConversationRow[] {
  const requests = new Set(thread.messages.map(message => message.id));
  const runs = thread.runs.filter(run => requests.has(run.messageId));
  const owned = new Set(runs.map(run => run.id));
  const rows: ConversationRow[] = [];
  for (const message of thread.messages) {
    if (message.role === "assistant" && message.runId && owned.has(message.runId)) continue;
    rows.push({ id: message.id, type: "message", message });
    for (const run of runs.filter(item => item.messageId === message.id)) rows.push({ id: run.id, type: "reply", run, messages: thread.messages.filter(item => item.role === "assistant" && item.runId === run.id) });
  }
  return rows;
}
