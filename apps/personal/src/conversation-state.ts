import type { Attachment, Mode } from "./types";

export type ConversationDraft = {
  text: string;
  attachments: Attachment[];
  replyTo?: string;
  mode?: Mode;
  connectionId?: string;
  recoveryError?: string;
  revision: number;
  pending?: { body: Record<string, unknown>; revision: number; create?: boolean };
};
export const emptyDraft = (): ConversationDraft => ({ text: "", attachments: [], revision: 0 });
export function settleCreatedDraft(current: ConversationDraft, revision: number, destination: ConversationDraft, ownsView: boolean): { source: ConversationDraft; target: ConversationDraft | null } {
  const remaining = current.revision === revision ? { ...emptyDraft(), mode: current.mode, connectionId: current.connectionId } : { ...current, pending: undefined };
  const occupied = Boolean(destination.text || destination.attachments.length || destination.pending || destination.recoveryError);
  if (!ownsView || occupied) return { source: remaining, target: null };
  return { source: emptyDraft(), target: remaining };
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";
const valid = (value: unknown): value is ConversationDraft => record(value) && typeof value.text === "string" && Array.isArray(value.attachments) && value.attachments.every(a => record(a) && typeof a.name === "string" && typeof a.text === "string");

export function restoreDraft(modern: unknown, legacy: unknown, create = false): ConversationDraft {
  if (valid(modern)) return { ...modern, revision: Number.isSafeInteger(modern.revision) ? modern.revision : 0 };
  if (!valid(legacy)) return emptyDraft();
  const old = legacy as ConversationDraft & { requestId?: string; signature?: string; memoryIds?: string[] };
  const draft: ConversationDraft = { text: old.text, attachments: old.attachments, mode: old.mode || "codex", connectionId: old.connectionId || "", revision: 0 };
  if (!old.requestId) return draft;
  try {
    const original: unknown = JSON.parse(old.signature || "");
    if (!valid(original) || !["codex", "local", "connection"].includes(original.mode || "") || !Array.isArray(old.memoryIds) || !old.memoryIds.every(id => typeof id === "string")) throw new Error("Invalid recovery record");
    // The store fingerprints JSON.stringify(body). Keep the original field order
    // and attachment shape from the previous sender, including omitted undefined.
    const body = { text: original.text, clientId: old.requestId, attachments: original.attachments.map(({ name, text }) => ({ name, text })), mode: original.mode, connectionId: original.connectionId || undefined, memoryIds: old.memoryIds };
    const unchanged = JSON.stringify({ text: old.text, attachments: old.attachments, mode: old.mode, connectionId: old.connectionId }) === old.signature;
    draft.pending = { body, revision: unchanged ? draft.revision : -1, ...(create ? { create: true } : {}) };
  } catch {
    draft.recoveryError = "原发送记录不完整，已保留草稿。请先核对原会话是否收到消息，避免重复发送。";
  }
  return draft;
}
