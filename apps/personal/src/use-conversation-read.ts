import { useEffect, useRef, type RefObject } from "react";
import { api } from "./api";
import type { Thread } from "./types";

/** A fetch or an active selection is not evidence that the owner saw a reply. */
export function useConversationRead(thread: Thread | null, visible: boolean, timeline: RefObject<HTMLDivElement | null>, onRead: (id: string, unreadCount: number) => void, renderVersion = 0) {
  const acknowledged = useRef(new Map<string, string>());
  const pending = useRef(new Set<string>());
  const recheck = useRef<(() => void) | null>(null);
  useEffect(() => {
    const message = thread?.messages.findLast(item => item.role === "assistant");
    if (!thread || !message || !visible || acknowledged.current.get(thread.id) === message.id) return;
    const node = timeline.current;
    if (!node) return;
    let frame = 0, disposed = false;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || document.hidden || !document.hasFocus() || document.querySelector("dialog[open]") || !node.getClientRects().length || node.clientHeight === 0) return;
        // Late run replies can be rendered beside an older question, or outside
        // the paginated rows. The scroll position alone cannot prove visibility.
        const reply = [...node.querySelectorAll<HTMLElement>('[data-testid="im-message"][data-message-id]')].find(item => item.dataset.messageId === message.id);
        if (!reply || pending.current.has(thread.id)) return;
        const viewport = node.getBoundingClientRect(), bounds = reply.getBoundingClientRect();
        if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) return;
        if (acknowledged.current.get(thread.id) === message.id) return;
        pending.current.add(thread.id);
        void api<{ unreadCount: number }>(`/threads/${thread.id}/read`, { messageId: message.id }).then(result => {
          acknowledged.current.set(thread.id, message.id);
          if (!disposed) onRead(thread.id, result.unreadCount);
        }).catch(() => { /* Keep unread state; the next refresh or focus retries. */ }).finally(() => {
          pending.current.delete(thread.id);
          if (acknowledged.current.get(thread.id) === message.id) recheck.current?.();
        });
      });
    };
    recheck.current = check;
    check();
    node.addEventListener("scroll", check, { passive: true });
    window.addEventListener("focus", check); window.addEventListener("resize", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      if (recheck.current === check) recheck.current = null;
      node.removeEventListener("scroll", check);
      window.removeEventListener("focus", check); window.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [thread, visible, timeline, onRead, renderVersion]);
}
