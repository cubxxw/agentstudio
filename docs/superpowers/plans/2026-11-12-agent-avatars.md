# AgentRoom avatars implementation plan

> **For agentic workers:** Implement natively using superpowers:executing-plans, then request independent review.

**Goal:** Stable local robot identities with polished, truthful activity motion.
**Architecture:** Share a pure versioned avatar schema between backend and renderer. Persist config on contacts and accepted run snapshots; derive activity from actual runs. Local DiceBear renderer and reusable CSS state frame cover existing avatar surfaces.
**Tech Stack:** React 19, TypeScript, CSS, Node tests, DiceBear 9.4.2.
**Spec:** docs/superpowers/specs/2026-11-12-agent-avatars-design.md

## Global constraints
- Brand remains AgentRoom. No remote avatar requests, arbitrary SVG, names-as-agent-fallback, fake progress or destructive data migrations.
- Keep existing explicit icons, real bot images and accepted history.
- Reuse builds; all large test artifacts belong in the registered DataSSD artifact directory.

## Review focus
- Rename/backend refresh/restart must preserve the selected seed.
- Pending input and uncertain stop must override work/completion motion.
- Historical snapshots must not inherit a newly chosen appearance.
- Reduced motion and hidden documents must stop animation.
- Invalid agent-proposed appearance cannot bypass schema validation.

### Task 1: Persistent identity and true activity
- [x] Add failing schema, activity and HTTP persistence/snapshot tests.
- [x] Implement server/agent-avatar.mjs and declarations, contact save/public/snapshot wiring and onboarding parameter adoption.
- [x] Run targeted Node tests and existing messenger/onboarding suites.

### Task 2: Avatar renderer and editor
- [x] Render a pinned local Bottts SVG with deterministic fallback, retain legacy explicit sources.
- [x] Add candidate picker, role palettes, parameter controls and finite live-state motion previews to ContactEditor.
- [x] Apply real activity consistently to current portraits, keep historical avatars still; implement reduced/disabled/hidden motion.
- [x] Run personal/desktop typechecks and unit suites, then render the editor in an isolated browser workspace and verify persistence, statuses, offline and narrow/dark layouts.

### Task 3: Deliver
- [ ] Update API/client/design contracts and package shared module.
- [ ] Independent agent review, fix confirmed issues, run latest checks.
- [ ] PR links GET-517, CI/merge, isolated native package acceptance; close issue only after acceptance and readback.
