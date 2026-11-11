# AgentStudio architecture

## Default macOS personal workspace

The existing Electron app opens the personal workspace by default. It retains its native `hiddenInset` window, traffic lights and Mac menus. The homepage is a personal messenger with contacts, direct messages, groups and unified approvals. Each conversation owns messages, sequential per-agent runs, versioned decisions and immutable Markdown artifacts. The default path needs no Matrix, Go, Postgres or bridge. See [setup and boundaries](personal/README.md), [desktop lifecycle](../apps/desktop/README.md) and [the decision record](personal/design.md).

```mermaid
flowchart LR
  R[Bundled personal file renderer] -->|dedicated preload, fixed IPC| M[Electron main]
  M -->|allowlisted requests, owned random loopback port| U[Owned utilityProcess]
  U --> DB[(Personal SQLite WAL and file vault)]
  U --> CLI[Existing configured Codex CLI]
  U -->|addressed contact chat| A2A[A2A chat endpoint]
  U -->|exact task or tool approval| REM[A2A task or MCP endpoint]
  U -->|change notifications| M
```

| Component | Ownership and boundary |
| --- | --- |
| Renderer | `out/renderer/personal/index.html`, separate `out/preload/personal.js`, `window.agentStudioPersonal`; production CSP has `connect-src 'none'`, so API HTTP stays outside the renderer. |
| Main | Accepts fixed JSON routes only from its trusted top-level personal document; native save dialog writes artifact bytes and verifies their hash. It rejects legacy session/connector IPC in personal mode. |
| Utility | `out/main/personal/worker.mjs` plus nine copied backend ESM files; Electron-bundled Node/SQLite, one workspace, port 0, owner/workspace handshake. It never attaches to an existing port 18740 service. |
| Data | `app.getPath('userData')/personal`, normally `~/Library/Application Support/AgentStudio/personal`; `AGENTSTUDIO_PERSONAL_DATA_DIR` selects an explicit directory. A separate SQLite lock rejects a second worker. No automatic import from Matrix, `.local/personal` or browser accounts. |

Closing the Mac window hides it while the utility continues. Quitting closes only the owned utility; recovery resumes queued work but preserves uncertain remote effects for reconciliation. One unexpected crash restart is bounded; requests are not automatically resubmitted. Concurrent explicit restarts coalesce, and a later shutdown supersedes an older restart. Forced PID termination requires the same captured and current utility identity. Source provenance records Git HEAD with `-dirty` when applicable.

The shared `apps/personal` UI and backend can also run as an auxiliary web service on 18740 (Vite development UI 18741), with separate `.local/personal` data. This is not the native default. Personal Bearer credentials use an AES-256-GCM file vault, not Keychain; prompts and CLI read-only shell policy do not enforce all configured plugin permissions. Account and packaging acceptance remain separately scoped in the [macOS ledger](personal/macos-acceptance.md).

## Retained Matrix architecture (v0.1)

Set `AGENTSTUDIO_WORKSPACE=matrix` to select the original renderer, preload, sessions and connectors. The remaining sections describe that path and keep its contracts intact.

AgentStudio is an open-source inbox for your chats and your AI agents. Agents show up as contacts. When an agent needs a decision, it sends an approval card. You can forward any message, with its context, to an agent and get reply drafts back.

v0.1 runs locally on macOS. Desktop (Electron) comes first, then mobile (Expo / React Native).

## Scope of v0.1

| In | Out (later) |
|---|---|
| Email-code sign-in, sessions, Matrix credentials minted per user | Google/Apple sign-in, invites |
| Synapse homeserver, federation off | Hosted multi-region, sliding sync |
| `demo` network bridge (simulated contacts, deterministic) for development and e2e | Stock mautrix bridges in e2e (they need real accounts), and dev scripts to run them (planned under `dev/bridges/`). |
| `agentstudio-agents` bridge speaking the open AgentStudio Agent Protocol, plus A2A and ACP agents through `agentstudio-agent-adapters` | OpenClaw gateway adapter |
| Desktop connectors for Grok Bot, Muse and ChatGPT Dots through the user's own signed-in session, on the Mac (`docs/connectors.md`) | Connectors that keep running while the Mac app is closed |
| Reference agent `concierge` (deterministic, used by e2e) | Hosted agents |
| Approvals (REST, versioned, idempotent) with cards in chat | Push gateway, APNs |
| Tasks: "Ask an agent" with context preview, drafts back, insert into chat | Merged chats, mutes, pins |
| Electron Mac app: inbox, chat, connect accounts, agents, approvals, tasks, ask | iMessage helper (phase 2, Mac-local) |
| Expo mobile app: same core flows. Tested on web target until Xcode is installed. | Native iOS builds |
| Playwright e2e against a locally started stack | CI |

## Processes and ports (local dev)

All processes bind to 127.0.0.1. Runtime state lives under `.local/` (git-ignored).

| Process | Port | What |
|---|---|---|
| PostgreSQL 18 (Homebrew binary, private cluster in `.local/pg`) | 54329 | databases `synapse`, `agentstudio`, `bridge_demo`, `bridge_agents` |
| Synapse (uv venv in `.local/synapse-venv`) | 18008 | homeserver, `server_name: agentstudio.local` |
| `agentstudio-api` (Go) | 18090 | REST `/v1/*`, internal `/internal/v1/*`, and a reverse proxy for `/_matrix/*` to Synapse. Clients use this single base URL. |
| `agentstudio-bridge-demo` (Go, mautrix bridgev2) | 18101 | appservice and provisioning |
| `agentstudio-bridge-agents` (Go, mautrix bridgev2) | 18102 | appservice, provisioning, agent callback endpoint `/agentstudio/v0/callback/*`, and `/agentstudio/internal/v1/approval-decisions` |
| `agentstudio-agent-concierge` (Go) | 18201 | reference agent implementing the AgentStudio Agent Protocol |
| `agentstudio-agent-adapters` (Go) | 18202 | the AgentStudio Agent Protocol in front of A2A agents (`/a2a/{target}`) and allowed ACP agents (`/acp/{agent}`) |
| `agentstudio-dev-a2a-echo` (Go, dev only) | 18203 | a tiny deterministic A2A agent for e2e |
| desktop connector host (inside the Mac app) | 18401 | the AgentStudio Agent Protocol for the Mac's connectors (`/c/{instance}`), per-instance bearer token |
| `e2e/fakes/agents.ts` (tests only) | 18410 | fake Grok Bot backend and fake Muse / Dots pages |
| mobile web (Expo export, static; or `pnpm dev:mobile`'s Expo dev server) | 18300 | e2e target for the mobile app |
| desktop renderer dev server (`pnpm dev:desktop` only) | 5173 | electron-vite / Vite dev server for the Electron renderer |

```mermaid
flowchart LR
  D[Electron desktop] -->|HTTP /v1, /_matrix| API
  M[Expo mobile] -->|HTTP /v1, /_matrix| API
  API[agentstudio-api :18090] -->|reverse proxy /_matrix| SYN[Synapse :18008]
  API -->|JWT login mints user tokens| SYN
  API -->|provisioning proxy, shared secret| BD[bridge-demo :18101]
  API -->|provisioning proxy, approval decisions| BA[bridge-agents :18102]
  SYN <-->|appservice| BD
  SYN <-->|appservice| BA
  BD -->|bridge state| API
  BA -->|bridge state, agents, approvals, task answers| API
  BA <-->|AgentStudio Agent Protocol| AG[concierge agent :18201]
  BA <-->|AgentStudio Agent Protocol| AD[agent-adapters :18202]
  AD <-->|A2A JSON-RPC| A2A[A2A agents]
  AD <-->|ACP stdio| ACP[ACP agent processes]
  BA <-->|AgentStudio Agent Protocol| CH[connector host in the Mac app :18401]
  CH <-->|user's own session| SVC[Grok Bot / Muse / ChatGPT Dots]
  API --> PG[(Postgres :54329)]
  SYN --> PG
  BD --> PG
  BA --> PG
```

## Repository layout

```
docs/                     architecture, API, agent protocol, Matrix events (the contracts)
server/                   Go module github.com/DolphinMiner/agentstudio/server
  cmd/agentstudio-api/
  cmd/agentstudio-bridge-demo/
  cmd/agentstudio-bridge-agents/
  cmd/agentstudio-agent-concierge/
  internal/api/...        REST handlers, auth, store, matrix minting, proxy
  internal/bridges/demo/  bridgev2 NetworkConnector
  internal/bridges/agents/
  internal/agentproto/    shared Go types for the AgentStudio Agent Protocol
  internal/agenthost/     agent side of the protocol (sessions, ordered callbacks) for adapters
  internal/adapters/      a2a/ and acp/ backends, served by cmd/agentstudio-agent-adapters
  internal/concierge/
packages/core/            TypeScript, no DOM or React Native imports: API client, session, Matrix client wrapper, event schemas, inbox model, ask builder
apps/desktop/             Electron + electron-vite; personal default and retained Matrix renderers, bundled locally
  src/main/personal-host.ts  owns the personal utility, fixed HTTP forwarding and native artifact saves
  src/main/worker.mjs     utility bootstrap; build copies the backend beside it
  src/preload/personal.ts dedicated personal IPC bridge
  src/main/connectors/    on-device connectors (Grok Bot, Muse, Dots) and their protocol host
apps/personal/            shared personal UI, native adapter, Node/SQLite engine and file vault
apps/mobile/              Expo (React Native) app using @agentstudio/core
e2e/                      Playwright: desktop (Electron) and mobile (Expo web) specs; fakes/ for the connectors
dev/                      local stack: stack manager (stack.mjs), config templates
```

## Key decisions

- **License Apache-2.0.** Synapse and stock mautrix bridges are AGPL. They run unmodified as separate processes, so their license does not reach this repo. Our bridges depend only on mautrix-go, which is MPL-2.0 and applies file by file.
- **One base URL per server.** Clients only know `AGENTSTUDIO_SERVER_URL`. The API proxies `/_matrix`, so desktop, mobile and web share one origin per server.
- **Mixed state.** Message content lives in Matrix. Approval and task state lives in REST, with `version` for optimistic concurrency and `idempotency_key` for retries. Cards in chat only reference REST ids.
- **No E2EE in v0.1.** Bridges must read plaintext. This matches the bridge model; see `docs/api.md` § Security.
- **Open protocols first, the user's own session where there is none.** Agents that speak the AgentStudio Agent Protocol, A2A or ACP connect on the server (`docs/agent-protocol.md`). Grok Bot, Muse and ChatGPT Dots have no public API, so the Mac app connects them through the user's own signed-in session (`docs/connectors.md`): their sign-ins stay on the Mac, encrypted, and the services can change or object at any time.
- **Determinism for tests.** The `demo` bridge and the `concierge` agent behave deterministically, so e2e runs without real accounts.

Historical personal tasks and current direct/group chats use the same Messenger renderer. `workspace=tasks` is a compatible old URL parameter, not a separate UI. Shared conversation tools own reading, connection preferences and precise approval; history keeps its existing thread IDs and protocols.
