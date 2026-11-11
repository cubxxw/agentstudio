import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar } from "../../personal/src/ContactAvatar";
import { ConversationTimeline } from "../../personal/src/ConversationTimeline";
import type { Contact, Thread } from "../../personal/src/types";

const sender: Contact = { id: "agent_remote", kind: "agent", name: "研究伙伴", handle: "research", description: "", instructions: "", color: "teal", icon: "auto", version: 1, binding: null, availability: "ready" };
const thread: Thread = {
  id: "thr_fixture", kind: "group", title: "讨论", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z", status: "completed", summary: "", artifacts: [], decisions: [], events: [],
  messages: [{ id: "input", role: "user", text: "一个想法", createdAt: "2026-11-11T00:00:00Z" }, { id: "reply", role: "assistant", text: "先从最小的一步开始。", createdAt: "2026-11-11T00:00:01Z", runId: "run", contactId: sender.id, contactSnapshot: sender, artifactId: "artifact" }],
  runs: [{ id: "run", messageId: "input", connectionId: "con_original", mode: "connection", status: "completed", createdAt: "2026-11-11T00:00:00Z", contactSnapshot: sender }],
};
const render = (value = thread) => renderToStaticMarkup(createElement(ConversationTimeline, {
  thread: value, contacts: [{ ...sender, binding: { type: "connection", connectionId: "con_new" }, avatarService: "grokbot" }], serviceAvatars: { con_original: "muse", con_new: "grokbot" }, limit: 80,
  onMore() {}, onReply() {}, onContact() {}, onSource() {}, onRun() {}, onError() {}, busy: "",
}));

describe("personal message presentation", () => {
  it("keeps a historical reply tied to its original connection after a contact is rebound", () => {
    const html = render();
    expect(html).toContain('data-avatar-source="muse"');
    expect(html).not.toContain('data-avatar-source="grokbot"');
    expect(html).toContain('aria-label="查看研究伙伴"');
  });
  it("shows direct reply content without duplicate identity or metadata", () => {
    const html = render({ ...thread, kind: "direct" });
    expect(html).toContain("先从最小的一步开始。");
    expect(html).not.toMatch(/im-message-meta|im-open-artifact|im-message-avatar|im-sender|<time/);
  });
  it("preserves an explicit persona icon instead of substituting a provider logo", () => {
    const html = renderToStaticMarkup(createElement(Avatar, { contact: { ...sender, icon: "research", avatarService: "muse" } }));
    expect(html).toContain('data-avatar-source="custom"');
    expect(html).not.toContain("<img");
  });
});
