# Unread chat badges

User request: show WeChat-style unread indicators when incoming chat messages have not been read.

The personal workspace currently has approval counts but no read cursor. Add a durable cursor in SQLite for each conversation, and derive unread counts from completed assistant messages after it. User messages, streaming updates, reactions and approval changes do not add unread messages. Incoming messages are counted individually in direct and group chats.

Use a red badge on conversation avatars, pinned shortcuts and the chat navigation icon. Show the real count accessibly and cap visible text at 99+. Add an unread list filter. Preserve separate approval indicators.

Advance the cursor only to an incoming message in the rendered snapshot while the conversation timeline is visible, the document is focused and visible, no modal covers it, and the latest persisted incoming reply intersects the timeline viewport. Late replies may appear beside an earlier question, so scroll position alone is insufficient. Background updates, other screens, hidden mobile detail, and reading history must preserve unread state. An acknowledgment of an older snapshot cannot consume a later reply or move the cursor backwards. Reading never changes conversation ordering.

On the first upgrade, baseline existing transcripts as read because historical reading cannot be reconstructed; count subsequent replies normally. Retain cursors across restarts. A frontend-only cursor was considered but would lose state with renderer storage resets and would not be owned by the workspace database. Counting updatedAt was rejected because approvals and streaming also change it.

Scope is personal desktop chat. Muting, system notifications and Matrix behavior are separate features.
