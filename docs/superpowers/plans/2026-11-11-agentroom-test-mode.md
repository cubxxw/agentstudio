# AgentRoom and test mode implementation plan

**Goal:** Rename the product to AgentRoom and make first-use testing safely repeatable.

**Architecture:** Preserve existing storage/wire identities. Native main owns profile selection and relaunch; the backend owns the durable welcome state. Test resets rotate isolated profiles rather than deleting live files.

**Spec:** ../specs/2026-11-11-agentroom-test-mode-design.md

## Task 1: Profile isolation and welcome persistence

- [x] Add failing behavior tests for a pure `resolveWorkspaceProfile` / `testWorkspaceArgs` helper and welcome API.
- [x] Implement fixed profile selection, safe argument validation, durable first-use state and self identity update.
- [x] Run the focused suites and commit.

## Task 2: Product branding and native controls

- [x] Update visible brand strings, packaging and current docs while preserving compatibility identifiers.
- [x] Expose a narrow native test-workspace action with confirmation, busy-state guard and graceful relaunch.
- [x] Add welcome/preferences UI, persistent return-to-welcome and visible test-mode indicator.
- [x] Run typechecks, focused tests and builds.

## Task 3: End-to-end delivery

- [x] Add browser/native acceptance for welcome, reset isolation and normal-profile recovery.
- [x] Run applicable workspace tests and existing journeys on this shared host.
- [ ] Obtain independent review, fix confirmed important findings, create associated PR, inspect latest CI and merge only when permitted gates pass.

## Review focus

1. Existing safeStorage identity and saved data survive rebranding.
2. CLI launch/environment overrides cannot route a test into a real personal directory.
3. Reset and leave reject active or unresolved work; old profile data remain recoverable.
4. Browser/foreign-frame requests cannot trigger native profile management.
5. New welcome UI does not block legacy links or existing user journeys.

## Review fixes

- Fixed P1 inherited native acceptance aliases using the shared test environment helper; actual profile resolver regression is RED→GREEN.
- Fixed P2 hidden test indicator with an independent badge and native title protection; native focused/offline regression is RED→GREEN.
- Preserved GET-492 while merging origin/main 160d517.
