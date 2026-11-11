# Local Agent Cards Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session; independent whole-branch review at the end.

**Goal:** Add selected local agents quickly and show useful, honest agent cards.

**Architecture:** Reuse Messenger stable discovered contacts and add an explicit `added` relationship flag with legacy visibility preserved. A fixed local-add API and shared React panel/card extend the existing personal UI and native IPC.

**Tech Stack:** Node/SQLite, React 19, TypeScript, Electron, existing Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-local-agent-cards-design.md`

## Global Constraints

- No new dependencies, model calls during discovery/adoption, network sharing, credential disclosure or changed execution defaults.
- Preserve all existing identities, configs, chats, drafts and accepted-run snapshots.
- Unknown quota/model/capabilities remain unknown. Only installed supported local adapters can be selected.
- Use documented `data-testid` selectors; reuse dependencies and isolated data, serialize resource-intensive checks.

## Review Focus

- Legacy contacts without `added` must remain visible; new unadded records must stay usable as backend inventory.
- Repeated/retried requests preserve names, versions, configuration, direct-chat identity and adoption across restart.
- A mixed valid/invalid batch cannot partially add agents; stale installations are freshly checked.
- Added but signed-out or model-incomplete agents remain visible and honestly unavailable.
- Local/remote card facts cannot turn configuration or an absent quota into an execution/account verification claim.

### Task 1: Explicit local adoption

Files: `apps/personal/server/messenger.mjs`, `index.mjs`, `messenger.test.mjs`, `server.test.mjs` (existing API test file), native IPC allowlist and tests.

Interfaces: `Messenger.addLocalAgents({agentIds}) → Contact[]`, `POST /api/contacts/local` `{agentIds,clientId}` → `{contacts}`. Store discovered system contacts with `added:false` only when newly discovered, migrate legacy as visible. No new identity ID.

- [x] Write failing lifecycle and batch validation tests; run them red.
- [x] Implement flag, adoption and fixed API; explicitly starting direct chat adopts for compatibility.
- [x] Run focused tests green, including native route allowance and API replay.

### Task 2: Quick add and shared card

Files: new `LocalAgentPicker.tsx`, `AgentCard.tsx` and their CSS; `WorkspaceTools.tsx`, `Messenger.tsx`, `MessengerDialogs.tsx`, `AgentProfile.tsx`, `types.ts`, discovery API/types as needed.

Interfaces: picker consumes `/integrations`, `/contacts/local` and existing contacts, reports selected stable contacts; shared card consumes public `Contact`. Visible address-book projection excludes `added:false` while backend editors retain inventory.

- [x] Add an isolated UI acceptance script first, verify its quick-add/card expectations fail before implementation.
- [x] Build shared picker, welcome/contact entries, filtering and read-only cards with truthful unknowns.
- [x] Typecheck and exercise selection → add → chat → profile, repeat/refresh and narrow layout.

### Task 3: Verification and delivery

Files: `docs/api.md`, `docs/clients.md`, `docs/architecture.md`, `docs/roadmap.md`, acceptance ledger.

- [x] Update contracts and phase roadmap in the same change.
- [x] Run full personal suite and applicable root/desktop checks; save bounded UI evidence outside source.
- [ ] Independent whole-branch review, fix confirmed important findings, verify latest CI, merge and read back issue status only when acceptance completes.
