import { describe, expect, it } from "vitest";
import { approvalContact } from "../../personal/src/approval-identity";
import type { Approval, Contact } from "../../personal/src/types";

const contact: Contact = { id: "planner", name: "New Bot", handle: "planner", kind: "agent", description: "", instructions: "", color: "teal", version: 1, binding: { type: "connection", connectionId: "con_original" }, availability: "ready" };
const approval: Approval = { id: "decision", version: 1, title: "确认方案？", summary: "", preview: "", choices: [], state: "pending", decision: null, deliveryState: null, actionState: null, verificationState: null, threadId: "thread", threadTitle: "计划", contact,
  source: { label: "Grok Bot", name: "New Bot", connectionId: "con_original", botId: "original_bot", requestText: null, threadKind: "direct" } };

describe("approval identity", () => {
  it("uses the recognizable current name without replacing the approved Bot with a new local backend", () => {
    const result = approvalContact(approval, [{ ...contact, name: "规划伙伴", handle: "planning", binding: { type: "local", localAgentId: "claude" }, avatarDataUrl: "new-backend-picture" }]);
    expect(result?.name).toBe("规划伙伴");
    expect(result?.handle).toBe("planning");
    expect(result?.binding).toEqual({ type: "connection", connectionId: "con_original" });
    expect(result?.avatarDataUrl).toBeUndefined();
    expect(result?.avatarService).toBe("grokbot");
    expect(approval.contact?.name).toBe("New Bot");
  });
  it("does not borrow another Bot's picture after a remote rebind", () => {
    const result = approvalContact(approval, [{ ...contact, binding: { type: "connection", connectionId: "con_other" }, avatarDataUrl: "other-bot-picture" }]);
    expect(result?.binding).toEqual({ type: "connection", connectionId: "con_original" });
    expect(result?.avatarDataUrl).toBeUndefined();
  });
  it("reuses a live portrait only from the exact approved connection", () => {
    expect(approvalContact(approval, [{ ...contact, avatarDataUrl: "original-bot-picture" }])?.avatarDataUrl).toBe("original-bot-picture");
  });
  it("retains historical identities when the contact is unavailable and leaves unknown contacts unassigned", () => {
    expect(approvalContact(approval, [])?.name).toBe("New Bot");
    expect(approvalContact({ ...approval, contact: null }, [contact])).toBeUndefined();
  });
});
