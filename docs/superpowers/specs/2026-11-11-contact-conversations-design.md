# Unified contact conversations

Ordinary messages addressed to a connected contact should send immediately. Muse,
Codex and other chat agents share the existing conversation, queue, reply identity,
visibility and recovery model; their adapters only differ in transport.

## Approach

Keep the shared Messenger and run engine. Classify a server-accepted A2A contact
message as chat, rather than as a proposed external task. Requiring approval for
every remote message repeats the user's Send action. Automatically approving all
remote actions would also authorize tool mutations and incidental task forwarding.
Instead, direct chats and addressed group messages authorize that contact's chat
transport only. MCP tool calls and legacy task dispatch retain exact approvals.

Snapshot the endpoint and credential binding privately when accepting a contact
message; dispatch and reconciliation must use that binding. A changed binding
blocks rather than silently sending to another destination. Preserve idempotent
acceptance, stable message IDs, post-join visibility and unknown-result recovery.
No fabricated approval records. Existing pending decisions remain explicit.

Chat replies display the returned text as local agents do; execution provenance and
the limited scope of artifact verification remain in run/artifact details.

## Admission and future work

Adding a human should eventually require a friend request and acceptance; the
current local-only address book does not deliver human messages over a network.
Host-advertised agent availability/configuration may support recommendations, but
adopting a recommendation requires an explicit save/accept action. Host status is
capability evidence, not authorization to connect, install, change providers or
share history. This fix does not introduce a friend network or host discovery
protocol, and does not mark those capabilities implemented.

## Verification

Exercise real API, SQLite and loopback A2A transport with synthetic service replies:
immediate chat and followups, exactly-once replay, group visibility, changed
endpoint/credential blocking, interrupted recovery and unchanged tool/task gates.
Run personal and desktop checks, then independent review of the authorization
boundary. Do not use private transcripts or send test messages to real contacts.
