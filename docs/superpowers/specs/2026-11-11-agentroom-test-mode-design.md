# AgentRoom branding and repeatable onboarding

The user chose AgentRoom and authorized implementation, including a mode that quickly clears the current test account and restarts onboarding. Existing host instructions authorize routine implementation decisions without another approval round.

## Decisions

- Rename user-facing desktop/mobile labels, notifications, connector copy, packaging and current documentation to AgentRoom. Keep npm scopes, IPC/preload names, protocol URLs, bundle ID, localStorage keys and the legacy Electron internal name/data directory compatible. In particular, changing Electron's internal name can strand existing safeStorage credentials; use AgentRoom for the visible menu, window and About panel while retaining that identity.
- Add an explicit native test mode, accessible in Preferences and through `pnpm dev:desktop:test`. A visible test indicator always distinguishes it. Native main code chooses a separate profile beneath the normal profile's `agentroom-test-profiles` directory. Ignore personal-data-directory overrides in this mode.
- Starting/resetting a test selects a new opaque profile ID, so SQLite, credentials, cookies, drafts and onboarding are fresh together. Previous profiles remain recoverable; no running directory is deleted or renamed. Explain this retention in the UI and documentation. Returning to the normal profile restores its existing data.
- Only the trusted personal renderer can request fixed `enter`, `reset`, `leave` actions over a dedicated IPC channel. No renderer-supplied path, reset HTTP route, account logout or global CLI credential deletion. Confirm switching/resetting in the native application and reject switches while known active or unresolved runs exist.
- The private utility preparation message freezes scheduling and new writes, waits for in-flight writes, and checks the full run ledger. Native login flows and non-completed service tasks also block switching. Relaunch only after confirming the owned utility actually exited; a resolved legacy stop promise alone is insufficient. Preserve command-line arguments except mode switches. A normal-mode argument overrides the test-mode environment variable when leaving.
- Add a first-use welcome on the empty home screen with owner name, start-chat, connection and agent-role setup choices. Completing it persists the owner name and onboarding marker. Existing populated workspaces are adopted without forcing onboarding. Preferences can reopen the welcome without clearing work.

## Verification

Behavior tests cover normal profile compatibility, explicit override precedence, path validation, test profile separation, fresh reset arguments and return-to-normal; onboarding API validation, persisted identity and existing-workspace adoption; trusted IPC validation and the absence of HTTP reset capability. Synthetic native acceptance covers onboarding, independent profile data, reset, and restoring the original profile. Browser acceptance covers onboarding persistence/reopening and preference controls. Current test suites and builds must pass. Independent review is required before the PR is merged.

No existing user worktree, account or service is reset during verification. Packaging and an actual launch are separate evidence; ad-hoc packaging does not establish notarization or production release.
