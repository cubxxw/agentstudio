# Tailscale Agent Nodes Implementation Plan

**Goal:** Enroll agents from several owned tailnet servers and chat through the existing desktop.
**Architecture:** Loopback A2A node with persistent tasks; authenticated manifest enrollment creates normal connections. Tailscale Serve owns TLS.
**Tech Stack:** Node >=22.13, SQLite, existing CLI adapters, React, Electron IPC.
**Spec:** `docs/superpowers/specs/2026-11-11-tailscale-agent-nodes-design.md`
**Execution:** Inline implementation, then independent agent review as required by AGENTS.md.

## Global Constraints

- No Docker, public Funnel, database replication, credential logging or arbitrary network commands.
- Reuse existing CLI and vault boundaries; loopback bind; HTTPS for remote URLs.
- Preserve running work and existing Serve routes; serialize local tests/builds.

## Review Focus

- Response loss before the first task receipt must not duplicate execution.
- Malicious manifests must not move credentials to another origin.
- Restart must not turn uncertain running work into a fresh execution.
- Re-enrollment must not silently change credentials for old pending requests.
- Invalid agent task lookup must not expose another agent's transcript.

### Task 1: Durable remote node

Files: `apps/personal/server/agent-node.mjs`, `agent-node.test.mjs`, `dev/agent-node.mjs`.

- [ ] Write node tests covering auth, idempotency, durable results, agent scopes, restart uncertainty and input limits; observe RED.
- [ ] Implement `createAgentNode(options)` with listen/close, task queue and authenticated manifest/A2A routes.
- [ ] Add init/serve/status CLI with private token file and explicit agents/public URL.
- [ ] Run `node --test apps/personal/server/agent-node.test.mjs`; expect PASS.

### Task 2: Enrollment and recoverable dispatch

Files: `remote-nodes.mjs`, `remote-nodes.test.mjs`, `index.mjs`, `runtime.mjs`, `messenger.mjs`, desktop runtime copy list and IPC allowlist.

- [ ] Write enrollment/reply-loss tests and observe RED.
- [ ] Implement `RemoteNodes` enrollment/list/check; atomically register normal A2A connections with node identity and predictable task IDs.
- [ ] Persist external task ID before dispatch only for enrolled nodes; use existing tasks/get reconciliation.
- [ ] Add narrow IPC routes and packaged backend module.
- [ ] Run personal tests sequentially; expect PASS.

### Task 3: UI, documentation and delivery

Files: `Connections.tsx`, `types.ts`, `docs/personal/remote-nodes.md`, architecture/API/protocol/clients references.

- [ ] Add server section with address/token enrollment, last-check status and refresh; keep tokens out of storage/history.
- [ ] Typecheck/build both apps; verify rendered form and registered contacts.
- [ ] Install isolated remote runtime on one known server, add only a free Serve listener and run a real CLI task.
- [ ] Review independently, fix confirmed issues, run applicable checks, link PR to GET-504 and merge after gates.
- [ ] Install updated desktop only when no work is running; retain acceptance evidence and recovery references. Read back Linear state.
