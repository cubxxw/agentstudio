import { APIError } from './store.mjs';

/** Workspace-owned read cursors. Message IDs bound acknowledgments to a rendered snapshot. */
export class UnreadMessages {
  constructor(store) {
    this.store = store;
    if (!store.get('setting', 'unread-migration-v1')) store.transaction(() => {
      // Historical reading is unknown. Do not turn an existing archive into new notifications.
      for (const thread of store.list('thread')) {
        const message = thread.messages.findLast(item => item.role === 'assistant');
        if (message) store.put('thread_read', { id: thread.id, messageId: message.id });
      }
      store.put('setting', { id: 'unread-migration-v1', completed: true });
    });
  }

  state(thread) {
    const cursor = this.store.get('thread_read', thread.id);
    const index = cursor ? thread.messages.findIndex(message => message.id === cursor.messageId) : -1;
    return { unreadCount: thread.messages.slice(index + 1).filter(message => message.role === 'assistant').length };
  }

  markRead(threadId, messageId) {
    return this.store.transaction(() => {
      const thread = this.store.require('thread', threadId);
      const index = typeof messageId === 'string' ? thread.messages.findIndex(message => message.id === messageId && message.role === 'assistant') : -1;
      if (index < 0) throw new APIError(400, 'bad_request', '请选择这段聊天中已显示的回复');
      const cursor = this.store.get('thread_read', threadId);
      const previous = cursor ? thread.messages.findIndex(message => message.id === cursor.messageId) : -1;
      const changed = index > previous;
      if (changed) this.store.put('thread_read', { id: threadId, messageId });
      return { ...this.state(thread), changed };
    });
  }
}
