import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar } from "../../personal/src/ContactAvatar";
import { ConversationTimeline } from "../../personal/src/ConversationTimeline";
import { ConversationList } from "../../personal/src/MessengerNavigation";
import type { Contact, Thread } from "../../personal/src/types";

const sender: Contact = { id: "agent_remote", kind: "agent", name: "研究伙伴", handle: "research", description: "", instructions: "", color: "teal", icon: "auto", version: 1, binding: null, availability: "ready" };
const thread: Thread = {
  id: "thr_fixture", kind: "group", title: "讨论", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z", status: "completed", summary: "", artifacts: [], decisions: [], events: [],
  messages: [{ id: "input", role: "user", text: "一个想法", createdAt: "2026-11-11T00:00:00Z" }, { id: "reply", role: "assistant", text: "先从最小的一步开始。", createdAt: "2026-11-11T00:00:01Z", runId: "run", contactId: sender.id, contactSnapshot: sender, artifactId: "artifact" }],
  runs: [{ id: "run", messageId: "input", connectionId: "con_original", mode: "connection", status: "completed", createdAt: "2026-11-11T00:00:00Z", contactSnapshot: sender }],
};
const render = (value = thread) => renderToStaticMarkup(createElement(ConversationTimeline, {
  thread: value, contacts: [{ ...sender, binding: { type: "connection", connectionId: "con_new" }, avatarService: "grokbot", avatarDataUrl: "data:image/png;base64,iVBORw0KGgoNEW=" }], serviceAvatars: { con_original: "muse", con_new: "grokbot" }, serviceImages: { con_new: "data:image/png;base64,iVBORw0KGgoNEW=" }, limit: 80,
  onMore() {}, onReply() {}, onContact() {}, onSource() {}, onRun() {}, onError() {}, busy: "",
}));

describe("personal message presentation", () => {
  it("renders Markdown in the conversation preview without interactive or block content", () => {
    const html = renderToStaticMarkup(createElement(ConversationList, {
      threads: [{ ...thread, lastMessage: { text: "我是 **Codex**，用 `pnpm` 和 *测试*。\n\n[文档](https://example.com) ![示意图](https://example.com/image.png)\n\n- ~~旧方案~~" } }],
      contacts: [], search: "", filter: "all", selected: null, loading: false, onOpen() {}, onNew() {},
    }));
    expect(html).toContain("<strong>Codex</strong>");
    expect(html).toContain("<code>pnpm</code>");
    expect(html).toContain("<em>测试</em>");
    expect(html).toContain("<del>旧方案</del>");
    expect(html).toContain("文档");
    expect(html).toContain("示意图");
    expect(html).not.toMatch(/\*\*|https:\/\/example|<(?:a|img|p|ul|li|pre)\b/);
  });
  it("shows a bot's own raster avatar before its service logo", () => {
    const avatarDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const html = renderToStaticMarkup(createElement(Avatar, { contact: { ...sender, avatarService: "grokbot", avatarDataUrl } }));
    expect(html).toContain(`src="${avatarDataUrl}"`);
    expect(html).toContain('data-avatar-source="bot"');
  });
  it("rejects arbitrary remote or active avatar URLs and preserves custom icons", () => {
    for (const avatarDataUrl of ["https://example.com/private", "data:image/svg+xml,<svg/>", "javascript:alert(1)"]) {
      const html = renderToStaticMarkup(createElement(Avatar, { contact: { ...sender, avatarService: "grokbot", avatarDataUrl } }));
      expect(html).not.toContain(avatarDataUrl);
      expect(html).toContain('data-avatar-source="grokbot"');
    }
    const html = renderToStaticMarkup(createElement(Avatar, { contact: { ...sender, icon: "research", avatarDataUrl: "data:image/png;base64,iVBORw0KGgo=" } }));
    expect(html).not.toContain("<img");
  });
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
