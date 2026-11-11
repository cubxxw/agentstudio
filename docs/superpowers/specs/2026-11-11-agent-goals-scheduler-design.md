# Per-agent goals and scheduling

The user approved implementing local contact discovery and role recommendations,
and requested per-agent goals, independent scheduling and editable basic settings.
They explicitly chose self scheduling only; cross-agent delegation is future scope.
The IM header shows the peer or group, with configuration behind that identity.

Use the existing single SQLite worker. Each agent owns one current goal and a
versioned schedule; schedules are disabled by default. Support interval (15–10080
minutes), daily local time with explicit IANA timezone, and bounded autonomous
continuation for executable local adapters. Remote chat agents support fixed
schedules; MCP tools and humans do not claim autonomous chat execution. Their
limitations remain visible. Defaults: 60 minutes, 09:00 Asia/Shanghai, four runs per
local day, and no enabled background work until the user saves it.

An enabled schedule authorizes ordinary messages only to that same agent's direct
conversation, with its own goal and conversation context. It does not grant extra
tools, other contacts' history, provider changes or cross-agent dispatch. A system
trigger is visibly distinct from an owner-authored message. Runs snapshot the
goal, persona, execution configuration and transport identity. User changes to the
goal or schedule invalidate queued schedule work; existing external submissions
remain subject to their original receipt and reconciliation rules.

Autonomous local cycles return a strict JSON reply, goal status (continue,
completed or needs_input), reason and bounded next delay (15–1440 minutes).
Structured envelopes never appear in streaming previews. The model may stop its
goal or choose the next time within owner-set limits; it cannot enable schedules,
raise its daily budget or change its backend. Unknown, failed, cancelled or
malformed results stop automatic continuation and retain visible evidence.

No overlapping cycles for one contact, a global single worker, normal user
messages preferred over queued scheduler work, missed times coalesced after sleep,
durable per-slot receipts, daily-budget enforcement and read-only task recovery
prevent runaway loops and duplicate sends. Quitting the app stops its own worker;
no OS wake daemon or recurring Codex app automation is created.

Clicking a chat identity opens a contextual profile sheet, preserving the selected
chat, draft and reading position. Sections: goal, schedule and existing basic/model
settings. Group details let the user open each member's profile; per-agent goal
results belong to that member's DM, not silently broadcast to the group. Show
next-run, last outcome, pause/resume, run-now and recent run links. State that Mac
app must be running. Keep provider/model details out of the chat header.

Reuse GET-490 onboarding for actual local model verification and role suggestions.
Add read-only host/discovery facts and a quiet candidate area; existing connected
agents open their existing chat, and new roles are adopted explicitly. Do not
create a second analysis queue or silently clone a single-conversation provider.

The fixed native routes are GET/POST /api/contacts/:id/control and POST
/api/contacts/:id/run. Writes require clientId and control version. The public
control shape is apps/personal/src/agent-control-types.ts. A raw MCP connection is
not a new chat persona; legacy history and already accepted work remain intact.
