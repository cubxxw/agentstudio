/** Calendar dates in the viewer's local time zone, including across DST changes. */
export function conversationTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const sameDay = (other: Date) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  if (sameDay(now)) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(yesterday)) return "昨天";
  return date.toLocaleDateString("zh-CN", { ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}), month: "numeric", day: "numeric" });
}
