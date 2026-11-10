# AgentStudio API contracts

## Default personal desktop IPC

The Mac app's default personal renderer calls `window.agentStudioPersonal`, exposed only by its dedicated preload. The shared source of types is `apps/personal/src/desktop-contract.ts`; desktop re-exports it in `src/shared/personal-api.ts`. The built renderer is a trusted local file, has no API HTTP connection permission, and cannot use the retained Matrix session/connector bridge.

```ts
type DesktopCommand = "new" | "search" | "settings"
type DesktopMethod = "GET" | "POST" | "DELETE"
type PersonalServiceId = "grokbot" | "muse" | "dots" | "cue"
type NativeIntegrationRequest =
  | {kind: "services"}
  | {kind: "connect"; serviceId: PersonalServiceId}
  | {kind: "progress" | "cancel"; flowId: string}
  | {kind: "choose"; flowId: string; choiceId: string}
  | {kind: "submit"; flowId: string; value: string}
  | {kind: "open" | "remove" | "reconnect"; instanceId: string}
  | {kind: "local-login"; agentId: "codex" | "claude"}
  | {kind: "local-login-status" | "local-login-cancel"; flowId: string}
type NativeIntegrationReply = {
  state: "catalog" | "waiting" | "choose" | "input" | "ready" | "failed" | "cancelled"
  flowId?: string; message?: string
  providers?: {id: PersonalServiceId; name: string; description: string}[]
  instances?: {id?: string; instanceId?: string; service?: PersonalServiceId;
    name: string; status?: string; canOpen?: boolean; connectionId?: string}[]
  connectionIds?: string[]
  actions?: {id: string; label: string}[]
  choices?: {id: string; label: string}[]
  label?: string; secret?: boolean; error?: string
  link?: {label: string; url: string}
}
interface PersonalDesktopBridge {
  readonly platform: string
  readonly version: string
  request(input: {path: string; method: DesktopMethod; body?: unknown}):
    Promise<{status: number; body: unknown}>
  onChanged(listener: () => void): () => void
  onCommand(listener: (command: DesktopCommand) => void): () => void
  saveArtifact(id: string): Promise<{
    cancelled: boolean; fileName?: string; path?: string; sha256?: string
  }>
  restart(): Promise<void>
  nativeIntegration?(request: NativeIntegrationRequest): Promise<NativeIntegrationReply>
}
```

`request` accepts only the following fixed paths; IDs are opaque, without URL syntax. Queries, arbitrary URLs/headers, file paths and shell commands are rejected. POST requires a JSON object of at most 2 MB; GET/DELETE accept no body.

| Method | Paths |
| --- | --- |
| GET | `/api/health`, `/api/bootstrap`, `/api/contacts`, `/api/contacts/:id`, `/api/approvals`, `/api/integrations`, `/api/connections`, `/api/memories`, `/api/threads/:id`, `/api/artifacts/:id`, `/api/connections/:id/tools` |
| POST | `/api/contacts`, `/api/contacts/:id`, `/api/chats`, `/api/chats/:id`, `/api/threads`, `/api/connections`, `/api/memories`, `/api/integrations/refresh`, `/api/integrations/connect`, `/api/integrations/local/codex`, `/api/integrations/local/claude`, `/api/threads/:id/messages`, `/api/threads/:id/retry`, `/api/threads/:id/reconcile`, `/api/threads/:id/cancel`, `/api/decisions/:id` |
| DELETE | `/api/connections/:id`, `/api/memories/:id` |

Main forwards to its own utility's random loopback port after validating the sender document and ownership handshake. There is no renderer route for SSE or artifact download: `onChanged` invalidates the UI snapshot, and `saveArtifact` uses a native dialog plus byte/hash readback. Runtime restart does not replay POST requests. `GET /api/health` includes the build reference, backend/UI hashes and desktop runtime versions.

Personal JSON uses **camelCase**, independently of the Matrix `/v1` contract below. `POST /api/threads` and `POST /api/threads/:id/messages` accept `{text,clientId,mode?,localAgentId?,connectionId?,attachments?,memoryIds?,action?}` and return the full thread. `localAgentId` accepts `codex` or `claude`; when omitted, the server snapshots the saved local selection (default `codex`) into the accepted run. `mode: "codex"` remains the compatibility name for automatic local routing and can use either adapter. Changing the default does not change an accepted run. `clientId` identifies an immutable request: same route/key/body returns its accepted receipt, even if a selected memory or completed connection was later removed; changed content returns 409. New requests validate current dependencies. Decisions require `{choice,version,clientId}`. Followups are durable sequential runs with context ending at their own message ID. Unknown execution blocks replay and later runs; an unconfirmed CLI stop also blocks new work using that same local assistant across threads.

### Personal contacts and messaging

The default personal homepage is an IM. Its contacts and conversations live in the same profile database as existing tasks; no Matrix data is imported. All mutations below require `clientId` (same body replays the accepted response, changed body returns 409).

| Route | Contract |
| --- | --- |
| `GET /api/contacts` | `{contacts}`; refreshes bounded local discovery and projects saved connections; preserves user-edited identity fields |
| `GET /api/contacts/:id` | One contact, including configured persona, backend binding, capability and login status; not proof of provider identity |
| `POST /api/contacts` | `{clientId,kind:"agent"\|"human",name,handle,description?,instructions?,color?,binding?}`; returns contact. Agent binding is `{type:"local",localAgentId}` or `{type:"connection",connectionId}`; human contacts are local-only |
| `POST /api/contacts/:id` | Same identity fields plus current `version`; updates increment version, stale writes return 409. Discovered contacts retain their backend |
| `POST /api/chats` | `{clientId,kind:"direct"\|"group",memberIds,title?}`; adds `self`. A direct chat reuses the peer's existing conversation. Group requires a title. Creation never runs a model |
| `POST /api/chats/:id` | Group only: `{clientId,version,title?,memberIds?,responsePolicies?:{[contactId]:"mention"\|"always"\|"manual"}}`; maximum 30 supplied members. New members receive only post-join material |
| `POST /api/threads/:id/messages` | For chat threads: `{clientId,text,attachments?,memoryIds?,replyTo?}`. Server selects bound agents; caller cannot redirect via `mode`, `connectionId` or `action`. Stores one user message and zero or more runs |
| `GET /api/approvals` | `{approvals}`; pending first, with original `threadId`, `threadTitle`, and frozen agent identity. Choices still use `/api/decisions/:id` with current version and a separate idempotent request |

Contacts have unique 2–32 character lowercase handles (`[a-z][a-z0-9_-]{1,31}`), an identity version and `availability` (`ready|unsupported|not_installed|login_required|disconnected|local_only|self`). Names are at most 80 characters, descriptions 300, persona instructions 3000. This version discovers Codex, Claude Code, Pi, Gemini CLI and OpenCode; only Codex and Claude have executable local adapters. A connection removed later remains a visibly disconnected contact rather than silently rebinding it.

Private agents respond directly. Groups default to exact `@handle`/reply addressing, with `@all` for executable members; paused members never auto-respond. Agent replies never enqueue agents. Unavailable or uncertain broadcast members are skipped with `message.skippedContacts`; a direct or explicit unavailable target returns 409 before accepting the message. Per-agent lanes let other members continue while one awaits approval or reconciliation; a new addressed message invalidates only that agent's old previews. The same run keeps its accepted persona, participants, visibility boundary and backend on retry. A2A approvals show the exact filtered conversation/identity payload; MCP planning uses the same filtered context. Joining does not grant earlier history or other conversations. Prompt boundaries do not override the CLI's actual configured plugin permissions.

Human contacts and their messages currently stay on this Mac. `deliveryState:"local_only"` is not remote delivery. Existing task threads remain readable in the IM and have an explicit `?workspace=tasks&thread=:id` resume action; their old recovery keys and drafts remain untouched.

### Personal discovery and quick connections

| Route | Request / response |
| --- | --- |
| `GET /api/integrations` | `{checkedAt,agents,selectedLocalAgentId,presets}`; fixed Codex/Claude/Pi/Gemini/OpenCode discovery, only Codex/Claude executable adapters |
| `POST /api/integrations/refresh` | `{}` → same response after forced discovery; concurrent discovery coalesces |
| `POST /api/integrations/local/:id` | `{}`, `id` only `codex` or `claude` → `{selectedLocalAgentId}`; requires installed, supported and auth `configured`, otherwise 409 |
| `POST /api/integrations/connect` | `{presetId,clientId?}` or `{url,token?,clientId?}` → public connection (201); only these four fields are accepted |

Each discovery agent contains `{id,name,installed,version,auth:{status,method?},execution:{supported,reason?},setupUrl,loginCommandId}`. Auth status is `configured|required|unknown|unsupported`; it does not prove account ownership, quota or network validity. Raw probe output, executable paths and credentials are not returned. Presets contain `{id,name,description,account,connectionId|null}` and use the fixed DeepWiki `https://mcp.deepwiki.com/mcp` and Exa `https://mcp.exa.ai/mcp` endpoints. Adding them initializes MCP and lists tools, without calling a tool. The preset request does not accept a nonempty URL or token override.

A custom URL tries a bounded same-origin Agent Card before MCP initialization/tool discovery. A card is metadata, not account proof or an executed task. Cross-origin advertised endpoints are rejected. Remote URLs require HTTPS; HTTP is allowed only on loopback, and credentials/query/fragment in URLs are rejected. `token` is optional: omit it or use `""` for no Bearer; explicit JSON `null`, whitespace, controls, non-ASCII or strings outside 8–8000 characters return 400. Existing advanced `POST /api/connections` remains available. Connection creation with the same optional `clientId` replays its accepted receipt; changed input returns 409. Concurrent identical quick-connect requests share discovery; a saved receipt is replayed before new remote probing. Discovery refresh and selecting the default do not require a `clientId`.

### Fixed native connection actions

`nativeIntegration` is a separate trusted-top-frame IPC capability, not an HTTP endpoint. It rejects extra fields and unknown actions; flow/choice/instance identifiers are bounded opaque strings. `submit.value` is a bounded string, not a command or URL to execute. Main owns personal-service sessions, registers A2A connections with its own backend, and reports ready only after registration. `reconnect` re-registers the named existing native instance; it does not mint a new account or blindly resend a task. `open` requires `canOpen`; `remove` preserves instances with active or unresolved work. A cancel racing with completed login can return ready and tell the user to disconnect the established instance instead.

Native catalog/progress/ready replies contain safe identifiers and labels, not saved service credentials, A2A tokens or A2A endpoint URLs. A user may explicitly submit a new key through a transient password input; it crosses the fixed IPC once and is not part of UI recovery storage or model context. Ordinary public connection records still expose their configured URL without a token. Native `local-login` runs only the fixed vendor login for Codex/Claude; status/cancel target its owned flow, and login completion is followed by fresh discovery, not an account-ownership claim. Auxiliary web clients do not gain this native capability. Lifecycle, isolation and nonreplay details are in [the connector contract](connectors.md#personal-workspace-native-services).

Public connections expose `auth:{type:"none"|"bearer",configured,identityVerified:false}`. Approval identity is `{label,authentication,identityVerified:false}`; the label is not account proof. For a native loopback connection, the UI names the personal Agent and says it connects through this Mac, keeping the full URL in technical details. Its local Bearer authenticates the adapter, not independent ownership of the provider account. A private credential/version binding prevents an old decision from changing identity. Tokens and private references are never public records or model inputs. Data belongs to the selected local personal workspace, without importing Matrix auth. See the [backend API, routing, vault and receipt contract](../apps/personal/server/README.md) for complete request shapes and verification scope. The auxiliary web service uses these `/api` endpoints directly with loopback checks; it is not the native renderer transport.

## Retained Matrix REST API (v1)

The remaining contract applies to `AGENTSTUDIO_WORKSPACE=matrix` and the Expo client.

Base URL: `AGENTSTUDIO_SERVER_URL`, for example `http://127.0.0.1:18090`. All bodies are JSON. Timestamps are RFC 3339 UTC strings. IDs are opaque strings.

## Conventions

- Auth header: `Authorization: Bearer <access_token>`. Every `/v1/*` route requires it except `/v1/auth/*`, `/v1/networks`, `/v1/health` and `/v1/dev/*`.
- Errors use one shape: `{"error": {"code": "snake_case", "message": "Human text"}}`. Codes and statuses:

  | Status | Code |
  |---|---|
  | 400 | `bad_request` |
  | 401 | `unauthenticated` |
  | 403 | `forbidden` |
  | 404 | `not_found` |
  | 409 | `version_conflict` |
  | 410 | `expired` |
  | 422 | `invalid_code` |
  | 429 | `rate_limited` |
  | 502 | `upstream_error` |

- Optimistic concurrency: mutating approvals and tasks requires the current `version`. A stale version returns 409 with the current object in `error.current`.
- Idempotency: a repeated `idempotency_key` for the same user and route returns the original result.
- CORS: the API allows the origins in `AGENTSTUDIO_ALLOWED_ORIGINS` (comma list). Dev mode also allows `http://127.0.0.1:*`, `http://localhost:*` and `null`. The desktop renderer may run from `file://`.
- `/_matrix/*` is reverse-proxied to Synapse unchanged. Clients pass `matrix.homeserver_url` (= base URL) to matrix-js-sdk.

## Health and dev

- `GET /v1/health` returns `{"ok": true, "synapse": true, "bridges": {"demo": true, "agentstudio-agents": true}}`.
- `GET /v1/dev/outbox?email=<email>` returns `{"messages": [{"to", "subject", "code", "sent_at"}]}`, newest first. It exists only when `AGENTSTUDIO_DEV=1`. E2e reads sign-in codes from it.

## Auth

The flow is email code sign-in. Codes are 6 digits, valid for 10 minutes, and stored hashed. A new code is allowed after 30 seconds.

- `POST /v1/auth/email/start {email}` returns 204. In dev mode the mail goes to the dev outbox and to the log.
- `POST /v1/auth/email/verify {email, code, device_name}` returns a `Session`. On a user's first sign-in the API creates the user and its Matrix account.
- `POST /v1/auth/local {device_name}` returns a `Session` for the person on this Mac, without an email code. Only in local mode (`AGENTSTUDIO_LOCAL=1`, which `GET /v1/health` reports as `local: true`), and only for requests from the same machine that no proxy forwarded. The account is always `you@agentstudio.local`.
- `POST /v1/auth/refresh {refresh_token}` returns a `Session`. The refresh token rotates; reusing an old one revokes the session.
- `POST /v1/auth/logout` returns 204. It revokes the session and logs out the Matrix device.
- `GET /v1/me` returns `{"user": User}`.

```ts
type User = { id: string; email: string; matrix_user_id: string; created_at: string }
type Session = {
  session_id: string
  access_token: string          // short-lived, 15 min
  access_expires_at: string
  refresh_token: string         // 60 days; clients keep it in secure storage
  user: User
  matrix: { homeserver_url: string; user_id: string; device_id: string; access_token: string }
}
```

The Matrix account is `@u_<user id>:agentstudio.local`. The API logs in to Synapse with `org.matrix.login.jwt`, signed with `SYNAPSE_JWT_SECRET`, `sub` = localpart. Synapse auto-registers the user and gives each session its own device.

## Networks and connections

Connections are proxied to mautrix bridgev2 provisioning (`/_matrix/provision/v3/...`, shared secret, `user_id` = the caller's Matrix ID). The API adds a `connection_id` and stores connections.

- `GET /v1/networks` returns `{"networks": [Network]}`.
- `GET /v1/connections` returns `{"connections": [Connection]}`.
- `POST /v1/connections/{network}/logins {flow_id}` returns `{"process_id", "step": LoginStep}`.
- `POST /v1/connections/logins/{process_id}/steps/{step_id} {"fields"?: {id: value}, "cookies"?: {id: value}}` returns `{"step": LoginStep}`.
- `POST /v1/connections/logins/{process_id}/steps/{step_id}/wait` returns `{"step": LoginStep}`. This is a long poll for `display_and_wait`, up to 60 s. On timeout it returns the unchanged step; the client polls again.
- `DELETE /v1/connections/{connection_id}` returns 204. It logs out the bridge login and marks the connection removed. Agents on the connection are paused.

```ts
type Network = {
  id: string                    // "demo" | "agentstudio-agents" | "whatsapp" | ...
  name: string                  // "Demo", "Agents", "WhatsApp"
  kind: "chat" | "agent"
  bot_mxid: string
  available: boolean            // bridge reachable
  flows: { id: string; name: string; description: string }[]
}
type Connection = {
  id: string                    // "<network>:<user_login_id>"
  network: string
  remote_name: string           // e.g. "Demo account", "Concierge"
  state: "connecting" | "connected" | "bad_credentials" | "transient_disconnect" | "logged_out"
  state_message?: string
  created_at: string; updated_at: string
}
type LoginStep = {                // mirrors bridgev2 LoginStep, plus AgentStudio's connection_id
  type: "user_input" | "display_and_wait" | "cookies" | "complete"
  step_id: string
  instructions?: string
  user_input?: { fields: { type: "username" | "phone_number" | "email" | "password" | "2fa_code" | "token" | "url" | "domain" | "select"; id: string; name: string; description?: string; default_value?: string; options?: string[] }[] }
  display_and_wait?: { type: "qr" | "emoji" | "code" | "nothing"; data?: string }
  cookies?: { url: string; user_agent?: string; fields: { id: string; required: boolean }[]; extract_js?: string }
  complete?: { user_login_id: string; connection_id: string }
}
```

## Agents

An agent is a contact backed by the `agentstudio-agents` bridge, one agent per connection. The bridge registers agents through the internal API.

- `GET /v1/agents` returns `{"agents": [Agent]}`.
- `PUT /v1/agents/{agent_id}/consent {ask_without_preview: boolean}` returns `Agent`. The setting is per user; "don't ask again" sets it to true.

```ts
type Agent = {
  id: string                    // "<connection_id>"
  connection_id: string
  name: string; description?: string; avatar_url?: string
  room_id: string | null        // the DM room with the agent ghost
  capabilities: ("chat" | "ask" | "approvals")[]
  status: "idle" | "working" | "offline"; status_text?: string
  pending_approvals: number
  consent: { ask_without_preview: boolean }
}
```

## Approvals

- `GET /v1/approvals?state=pending|all` returns `{"approvals": [Approval]}`, newest first. The default is `pending`.
- `GET /v1/approvals/{id}` returns `Approval`.
- `POST /v1/approvals/{id}/decision {choice, version, idempotency_key}` returns `Approval`. It sets state `decided`, delivery `queued`, then delivers to the bridge synchronously (5 s timeout). Delivery ends as `delivered` or `failed`. A decision after `expires_at` returns 410.

```ts
type Approval = {
  id: string; version: number
  agent_id: string; agent_name: string
  room_id: string | null; event_id: string | null   // the card message in the agent room
  title: string                 // "Book the 6pm flight to Toronto for $412?"
  summary?: string
  details: { label: string; value: string }[]
  choices: { key: string; label: string; category: "approve" | "deny" }[]
  state: "pending" | "decided" | "expired" | "cancelled"
  decision: { choice: string; decided_at: string } | null
  delivery_state: "queued" | "delivered" | "failed" | null
  expires_at: string | null
  created_at: string; updated_at: string
}
```

## Tasks ("Ask an agent")

The client creates the task, then sends the ask message into the agent's room. The message has content key `com.agentstudio.ask` with `task_id`; see `docs/matrix-events.md`. The bridge forwards the ask to the agent. Draft replies come back as a `com.agentstudio.drafts` message, and the bridge marks the task `answered`.

- `POST /v1/tasks {agent_id, idempotency_key, request_text, origin, title?}` returns `Task` with state `pending`. `title` is the anchor message text (the API keeps its first line, 80 chars max); without it the title comes from `request_text`.
- `GET /v1/tasks?state=open|all` returns `{"tasks": [Task]}`. `open` means `pending` + `answered`.
- `POST /v1/tasks/{id}/sent {version, draft_index}` returns `Task` with state `done`. The user sent a draft back to the origin chat.
- `POST /v1/tasks/{id}/cancel {version}` returns `Task` with state `cancelled`.

```ts
type Task = {
  id: string; version: number
  agent_id: string; agent_name: string
  state: "pending" | "answered" | "done" | "cancelled" | "failed"
  title: string                 // first line of the anchor message, 80 chars max
  request_text: string
  origin: { room_id: string; network: string; chat_name: string; anchor_event_id: string }
  answer: { event_id: string; drafts: { text: string }[] } | null
  sent_draft_index: number | null
  created_at: string; updated_at: string
}
```

## Internal API (bridges only)

Internal routes authenticate with `Authorization: Bearer <AGENTSTUDIO_INTERNAL_SECRET>` and are never exposed through CORS.

- `POST /internal/v1/bridge-state` receives bridgev2 `status_endpoint` posts (BridgeState JSON, which includes `user_id`, `remote_id`, `remote_name`, `state_event`). The API upserts the connection state. Exception to the internal secret: bridgev2 authenticates this call with its appservice `as_token`, so the API accepts any configured bridge `as_token` here.
- `PUT /internal/v1/agents {owner_mxid, connection_id, name, description?, avatar_url?, capabilities, room_id?}` upserts an agent and returns `Agent`.
- `PATCH /internal/v1/agents/{agent_id} {status?, status_text?, room_id?}` returns `Agent`.
- `POST /internal/v1/approvals {owner_mxid, agent_id, external_id, title, summary?, details, choices, expires_at?, room_id?, event_id?}` returns `Approval`. It is idempotent on (agent_id, external_id).
- `PATCH /internal/v1/approvals/{id} {room_id?, event_id?, state?: "cancelled"}` returns `Approval`.
- `POST /internal/v1/tasks/{id}/answer {event_id, drafts}` returns `Task` with state `answered`.
- `POST /internal/v1/tasks/{id}/fail {reason}` returns `Task` with state `failed`.

The API calls the agents bridge with the same internal secret:

- `POST {AGENTS_BRIDGE_URL}/agentstudio/internal/v1/approval-decisions {approval_id, agent_id, external_id, choice}` returns 200 when delivered to the agent.

## Security notes (v0.1)

- Access tokens are HMAC-SHA256 JWTs (`AGENTSTUDIO_TOKEN_SECRET`). Refresh tokens and email codes are stored only as SHA-256 hashes.
- Matrix tokens are minted per session. Logging out deletes the Matrix device.
- Agent tokens and bridge credentials live in the bridge databases. Message bodies and tokens are never logged.
