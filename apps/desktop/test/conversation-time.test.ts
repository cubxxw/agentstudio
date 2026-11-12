import { describe, expect, it } from "vitest";
import { conversationTime } from "../../personal/src/conversation-time";

describe("conversation list dates", () => {
  const local = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour);
  it("reserves clock times for today's conversations", () => {
    expect(conversationTime(local(2026, 11, 11, 9).toISOString(), local(2026, 11, 11))).toBe("09:00");
    expect(conversationTime(local(2026, 11, 9).toISOString(), local(2026, 11, 11))).toBe("11/9");
  });
  it("recognizes yesterday over month, leap-day and year boundaries", () => {
    for (const [date, now] of [[local(2026, 10, 31), local(2026, 11, 1)], [local(2024, 2, 29), local(2024, 3, 1)], [local(2025, 12, 31), local(2026, 1, 1)]]) {
      expect(conversationTime(date!.toISOString(), now)).toBe("昨天");
    }
  });
  it("includes the year for older conversations and handles missing dates", () => {
    expect(conversationTime(local(2025, 11, 9).toISOString(), local(2026, 11, 11))).toBe("2025/11/9");
    expect(conversationTime("", local(2026, 11, 11))).toBe("时间未知");
  });
});
