# Grok Bot approval synchronization implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task in the current session.

**Goal:** Complete real Grok Bot messaging and bidirectional approval synchronization in AgentRoom.

**Architecture:** A durable native approval ledger serves fixed authenticated local RPC operations. A backend provider inbox privately registered by main reuses Decisions and resumes existing tasks by readback only.

**Tech Stack:** Electron 45.2.1, TypeScript, Node/SQLite ESM, existing React UI and Connect RPC.

**Spec:** `docs/superpowers/specs/2026-11-11-grok-approvals-design.md`.

## Global constraints

Preserve accounts, native sessions, other bots and services. No history import, credential export, blanket approval, new dependency or Docker. Use exact identity/version binding and durable idempotency; unknown mutations are never replayed. Use serial tests/builds on this shared host.

## Review focus

- Long/duplicate option values and unsupported cards preserve exact semantics.
- External response races and card revisions invalidate stale local actions.
- Empty/omitted/paginated data never proves a card answered.
- Restart with pending versus in-flight mutations preserves distinct states.
- Partial pre-approval text never completes a resumed task.

## Task 1: Login and provider state

Files: `connectors/manager.ts`, `connectors/grokbot.ts`, `connectors/types.ts`, connector tests.
- [ ] Add failing tests for browser-open fallback, structured widget resolution/revisions and exact choices.
- [ ] Implement bounded official-browser fallback and Grok approval readback/respond validation.
- [ ] Persist the original personal turn across approval waits; test restart, old sequence updates and final replies.
- [ ] Run connector tests and commit.

## Task 2: Durable native approval ledger

Files: new `main/provider-approvals.ts`, `main/personal-services.ts`, native adapter tests.
- [ ] Add failing tests for independent/linked cards, exact revision decisions, idempotency and restart.
- [ ] Serve fixed `agentstudio/approvals/list` and `agentstudio/approvals/respond` over the existing authenticated local endpoint.
- [ ] Persist before dispatch; reconcile resolved provider records without repeating uncertain writes.
- [ ] Run native ledger and connector tests and commit.

## Task 3: Backend inbox and decision processing

Files: new `server/provider-approvals.mjs`, `server/index.mjs`, `runtime.mjs`, main host/worker/source registration, backend tests.
- [ ] Add failing tests for private source registration, independent inbox cards, choices, external resolution, version conflict, retry/unknown and run continuation.
- [ ] Privately register owned native sources; project cards into the bot's direct conversation without fake runs.
- [ ] Persist and process explicit provider choices independently of the model worker. Resume only matching original tasks by `tasks/get`.
- [ ] Preserve old send/MCP approval behavior; run host/backend tests and commit.

## Task 4: UI, contracts and delivery

Files: Decision presentation, conversation approval affordances, shared types, API/connector/client contracts and acceptance scripts.
- [ ] Show exact provider option and handling source in the existing approval card; keep stale/sending/unknown states readable.
- [ ] Run typechecks, relevant full tests, real Electron integration and current CI.
- [ ] Obtain independent diff review; fix confirmed important findings.
- [ ] Install a clean reviewed bundle with rollback, verify the real account and both approval directions, restart and read back receipts.
- [ ] Merge after gates, record exact evidence/revision, complete GET-496 after acceptance, and remove only owned disposable resources.

## Execution ledger

- Implemented exact opaque options, native card/readback ledger, independent watcher, private utility source registration and browser fallback.
- Ruling: retain the native ledger in `personal-services.ts` alongside the existing manifest, rather than introduce a second native persistence owner.
- Native permission cards synchronize state but require the original app to grant access.
- Independent review fixes cover fresh-card absence, answer echoes, pending restart, partial text boundaries, removal guards, cross-revision unknown isolation and late snapshot regression.
- Desktop suite: 158 passing before final UI status labels and multiple-card echo adjustment. Existing personal suite: 136 passing; three new watcher/API tests passing. Live acceptance and final CI remain open.
