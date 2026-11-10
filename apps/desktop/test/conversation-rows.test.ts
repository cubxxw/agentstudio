import { expect, it } from "vitest";
import { conversationRows } from "../../personal/src/conversation-rows";
import type { Thread } from "../../personal/src/types";

it("keeps each running or queued answer next to its originating question", () => {
  const thread = { messages: [{ id: "m1", role: "user" }, { id: "m2", role: "user" }], runs: [{ id: "r1", messageId: "m1", status: "running" }, { id: "r2", messageId: "m2", status: "queued" }] } as Thread;
  expect(conversationRows(thread).map(row => row.id)).toEqual(["m1", "r1", "m2", "r2"]);
});
it("a late final answer replaces the same response slot while preserving unrelated messages", () => {
  const thread = { messages: [{ id: "m1", role: "user" }, { id: "m2", role: "user" }, { id: "a1", role: "assistant", runId: "r1" }, { id: "standalone", role: "assistant" }], runs: [{ id: "r1", messageId: "m1", status: "completed" }] } as Thread;
  const rows = conversationRows(thread);
  expect(rows.map(row => row.id)).toEqual(["m1", "r1", "m2", "standalone"]);
  expect(rows[1].type === "reply" && rows[1].messages[0].id).toBe("a1");
});
