# One messenger for every conversation

GET-484. The previous delivery left two renderers: Messenger opens history, then a button navigates to the complete task workspace. This changes navigation, visual language and composer behavior mid-conversation. The user asks to remove that split, under the existing instruction to proceed autonomously.

Use a single Messenger renderer. Old `workspace=tasks` links resolve to that renderer and keep their thread. Existing records remain unchanged. Continue historical threads through their original message endpoint with the original execution mode and connection. “整理资料” starts a local conversation inside the same shell. A recoverable old `new` draft stays accessible there.

Preserve drafts without sending automatically. A legacy `requestId`, `signature` and `memoryIds` reconstruct the exact original body, including property order and attachment fields, because the backend fingerprints JSON. Keep that pending request separate from later edits; preserve its create/message endpoint. A new Messenger draft takes precedence over its retained legacy backup. Malformed records must not create an automatic send.

Keep the three navigation entries: chats, contacts, approvals. Results and execution history open from a conversation; receipt details remain collapsed. Connections, saved memory, reading and approval use the same system font, blue actions, white surface and dark mode tokens. Navigation never replaces the entire shell. Reuse the existing secure connection and artifact components rather than reimplementing credentials or protocols.

Palette: action #2388d1, selection #e9f3fc, canvas #f1f5f8, surface #ffffff, text #1e2c38, secondary #738391. Left alignment, system typography, round message bubbles; no additional dashboard or mode switcher. Settings and reading are contextual dialogs with consistent headers and controls.

Alternatives considered: recoloring the old workspace still retains two navigation models; mounting it inside a chat retains duplicate sidebars and independent drafts. A single renderer with reusable tools fixes the actual transition and makes preservation testable.

Acceptance: historical links and normal startup show the same shell; history sends to the same thread and executor; draft reload and late responses preserve edits; pending retries deduplicate; results can be read/downloaded; run/approval recovery remains; keyboard, narrow and dark views remain usable. Do not add human messaging networks, change provider/account selection, or modify existing personal data during synthetic tests.
