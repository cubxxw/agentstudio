# Group Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give groups a designed default and allow the owner to choose a motif/color or local picture.

**Architecture:** Store a bounded `groupAvatar` descriptor on the existing group thread and expose it through summaries. A shared group portrait renderer and local image normalizer serve the existing editor and every avatar surface.

**Tech Stack:** React 19, strict TypeScript, CSS/SVG, Node SQLite/HTTP, Electron and existing Playwright tests.

**Spec:** [Group avatar design](../specs/2026-11-11-group-avatar-design.md)

## Global Constraints

- Preserve legacy groups, conversation data, native IPC/CSP, account and signing identities.
- Local PNG/JPEG/WebP input ≤5 MiB; saved square PNG ≤256×256 and ≤96 KiB.
- No new dependencies or external image requests.

## Review Focus

- Invalid, oversized or disguised image input must fail without changing the group.
- A late image read must not overwrite a newer selection or close action.
- Concurrent edits must keep existing optimistic version/idempotency behavior.
- Every group portrait surface must use the saved descriptor after reload.
- Repackaging must retain AgentRoom's new app name/icon and stable local signature.

### Task 1: Persist and validate group avatars

**Files:** `apps/personal/server/group-avatar.mjs`, `group-avatar.test.mjs`, `messenger.mjs`, `index.mjs`, `apps/desktop/electron.vite.config.ts`.

- [ ] Write API regressions for preset/image create/update, summary/restart, reset, invalid input, direct-chat rejection and conflicts. Run `node --test apps/personal/server/group-avatar.test.mjs` and observe the missing-feature failure.
- [ ] Add bounded validation before writes; expose metadata in summaries and package the backend module. Run the same tests and the existing messenger suite.

### Task 2: Draw portraits and edit them

**Files:** `apps/personal/src/GroupAvatar.tsx`, `GroupAvatarEditor.tsx`, `group-avatar-image.ts`, `group-avatar.css`, `ContactAvatar.tsx`, `MessengerDialogs.tsx`, `MessengerNavigation.tsx`, `Messenger.tsx`, `types.ts`.

- [ ] Add a shared portrait, picker and latest-selection-safe local image normalization.
- [ ] Pass the saved descriptor to all avatar surfaces. Keep data-testid contracts and preserve the selected draft on failure.
- [ ] Run personal/desktop type checks and render the actual flow at desktop and narrow sizes.

### Task 3: Verify the full owner flow

**Files:** `dev/group-avatar-acceptance.mjs`, `docs/clients.md`, `docs/api.md`, `docs/personal/group-avatar-acceptance.md`.

- [ ] Add isolated browser and packaged native journeys for create, edit, upload/crop, reload, cancel, reset, errors and all rendering surfaces. Browser plugin is absent; use the repository's Playwright setup.
- [ ] Capture light/dark and narrow screenshots outside Git, inspect them and fix any usability defects.
- [ ] Run appropriate backend, desktop and packaging checks. Obtain independent agent review as required by AGENTS.md for the persistence/image boundary.

### Task 4: Deliver

- [ ] Commit, create and attach a PR linked to GET-508, resolve confirmed high-priority findings and wait for current-head CI.
- [ ] Merge after gates pass; build/install with stable signing at `~/Applications/AgentRoom.app`, verify native name/icon and retained workspace data.
- [ ] Record real evidence, update/read back Linear only after acceptance, and archive the task worktree after preserving recovery materials.
