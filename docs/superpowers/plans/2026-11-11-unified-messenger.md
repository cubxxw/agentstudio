# Unified Messenger Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, then an independent whole-branch review. Steps use checkbox syntax.

**Goal:** Continue every existing conversation in the same Messenger shell.
**Architecture:** Remove the old renderer branch, share contextual tools, and adapt saved legacy drafts to the Messenger send flow without changing server records or protocols.
**Tech Stack:** React 19, TypeScript, existing IPC/HTTP personal APIs, Playwright and Vitest.
**Spec:** `docs/superpowers/specs/2026-11-11-unified-messenger-design.md`

## Global constraints

- Keep existing thread IDs, credentials, connections and saved documents.
- Preserve exact legacy pending request bodies and client IDs. Never send during migration.
- A single Messenger renderer, the existing blue/white tokens and system font.
- No new dependencies, providers or message networks.

## Review focus

- A lost create response must retry `/threads` with the original key, then open the returned existing thread.
- Later edits must coexist with the original pending request and survive a late response.
- A modern empty saved draft must prevent an old backup from reappearing.
- Legacy mode/connection and original attachment fields must survive migration and reload.
- Results, independent run controls, exact approvals and connection setup must remain accessible on narrow screens.

### Task 1: Preserve conversation drafts

Files: `apps/personal/src/conversation-state.ts`, `apps/desktop/test/conversation-state.test.ts`.
Interface: `ConversationDraft`; `restoreDraft(modern, legacy)`; `emptyDraft()`; exact pending body plus optional create endpoint.

- [x] Test exact reconstruction, later edits, new-draft precedence, malformed input and original create retry; observe RED.
- [x] Implement adapter and verify focused tests GREEN.

### Task 2: One shell and its tools

Files: `Messenger.tsx`, `MessengerDialogs.tsx`, `ConversationPanels.tsx`, `ConversationDetails.tsx`, `messenger.css`; remove obsolete `App.tsx` renderer.
Consumes draft adapter. Produces one navigation and send flow for historical and current chats.

- [x] Reproduce historical URL loading the old shell using isolated browser acceptance.
- [x] Integrate historical/scratch composer, result/history dialog and scoped mode/connection selection. Preserve pending request recovery and per-chat drafts.
- [x] Extract shared panels and align every dialog with the Messenger visual tokens; remove whole-page workspace navigation.
- [x] Verify browser and actual Electron history + standard messenger journeys; inspect screenshots at normal/narrow/dark sizes.

### Task 3: Delivery and contracts

Files: client and personal docs, acceptance harnesses and CI browser entry.

- [x] Replace obsolete task-renderer assertions with unified-flow assertions retaining queue, unknown-receipt, artifact/download and recovery coverage.
- [x] Run typechecks, affected unit suites, complete browser/native acceptance and independent review; fix important findings.
- [ ] Link PR to GET-484; CI-gated normal merge, install and verify the actual application revision/data; close issue only after acceptance.

## Execution decisions

Proceed inline under the user's autonomous-work agreement; no additional design approval question. The independent reviewer checks migration semantics and the final branch. Keep old storage keys as recovery backups. Runtime/account/keychain boundaries remain unchanged.

Reviewer P1 fixed with RED/GREEN: a late create response could overwrite an existing destination draft. `settleCreatedDraft` preserves it and keeps source edits at their original draft when navigation changed. Two UI regressions verify existing destination drafts and a POST held until the new thread is opened and edited. Default history mode respects requestedMode, and cancelled-but-unconfirmed runs remain visibly pending verification.
