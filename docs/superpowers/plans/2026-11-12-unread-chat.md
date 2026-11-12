# Unread chat implementation plan

Goal: persist and display unread incoming chat messages in the personal workspace.
Architecture: SQLite read cursor by message ID; bounded acknowledgment endpoint; renderer acknowledges only a visible latest timeline.
Spec: ../specs/2026-11-12-unread-chat-design.md

- [x] Add failing API regressions for incoming-only counts, monotonic bounded acknowledgments, restart persistence, migration and unchanged ordering.
- [x] Add unread state service, bootstrap/detail fields and fixed IPC acknowledgment capability.
- [x] Add avatar/navigation badges and unread filtering. Cover the renderer visibility/read policy with unit and real Electron acceptance.
- [x] Run scoped tests, types and isolated desktop UI acceptance; independent review before merging. Update API/client contracts.
- [ ] Create linked PR, pass latest CI, merge, verify merged behavior, update Linear and preserve evidence before cleaning task resources.

Review focus: a late reply arriving during an acknowledgment; stale snapshots; historical message scrolling; hidden or unfocused windows; initial adoption of existing messages.
