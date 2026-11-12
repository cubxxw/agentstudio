import type { Contact } from "./types";

export function presenceText(contact?: Pick<Contact, "presence"> | null): string {
  const p = contact?.presence;
  if (!p) return "";
  const label = p.state === "online" ? p.waiting ? "等待审批" : p.running ? `正在处理${p.running > 1 ? ` ${p.running} 项任务` : ""}` : "在线"
    : p.state === "reconnecting" ? "正在重连…" : p.state === "offline" ? "离线" : p.state === "attention" ? p.reason || "需要检查" : "在线状态待检查";
  return [label, p.deviceName].filter(Boolean).join(" · ");
}
