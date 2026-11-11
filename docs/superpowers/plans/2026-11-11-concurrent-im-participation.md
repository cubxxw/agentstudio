# Concurrent IM Participation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement these tasks in this session; independent review covers the whole branch before landing.

**Goal:** Group agents read independently and respond with text, reaction or silence, without serial queued reply placeholders.

**Architecture:** Replace the single active invocation with a bounded registry and conservative execution lanes. Keep SQLite/idempotency and frozen identity/visibility/configuration; add versioned IM preferences, exact input receipts and reaction mutations.

**Tech Stack:** Existing Node/SQLite ESM, React/TypeScript, Electron and Playwright; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-concurrent-im-participation-design.md`

## Global constraints

- Three independent invocations maximum; shared remote session lanes serialize.
- Preserve unknown-result barriers, cancellation identity, accepted snapshots and post-join visibility.
- Agent messages/reactions do not recursively invoke models. No new external write permissions.
- Synthetic acceptance data only. Resource audit before tests; sequential host checks/builds.

## Review focus

- Cancellation of one concurrent run must not stop or swallow progress from another.
- Multiple queued members in one group must not hide an eligible member behind a busy lane.
- A removed/rejoined member must not obtain a newly published old run's content or reaction.
- A setting change after acceptance must not change that invocation's response contract.
- A restart, duplicated send or repeated reaction must not duplicate public output or acknowledge unread context.

## Tasks

1. [x] Add failing gated server tests for concurrent group reads, ordered follow-ups, isolated stop/progress, pool limit, remote shared-lane barriers and close.
2. [x] Implement the worker active registry and lane-aware queued selection in `runtime.mjs`/`store.mjs`; preserve legacy `promise`/single-run diagnostics where needed. Run worker and existing server tests.
3. [x] Add failing tests for exact visible-input receipts, same-input published peer context, silence settings/snapshots and reaction output/idempotency/visibility. Implement in `messenger.mjs`, `runtime.mjs`, `index.mjs` and shared types.
4. [x] Add reaction controls and grouped actor labels to the timeline; hide group queued reply slots, show honest aggregate activity, expose IM and group silence settings. Extend fixed IPC allowlist and test IDs. Verify with TypeScript and browser acceptance.
5. [x] Update architecture/API/client/backend contracts and acceptance ledger. Run applicable tests, isolated native acceptance and independent review; fix confirmed problems.
6. [ ] Commit and push a linked Linear branch/PR, pass current CI, merge, install the accepted bundle with data preserved if no live-run conflict, then read back Linear delivery status.
