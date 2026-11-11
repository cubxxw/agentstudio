# Group participation and onboarding implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans, with independently reviewed delivery.

**Goal:** Group members choose whether to speak; a tested local backend proposes grounded roles before explicit adoption.
**Architecture:** Extend member response policies and use structured participation decisions. A dedicated onboarding module stores jobs, reusing hidden threads in the existing queue and fixed IPC.
**Tech Stack:** Existing Node SQLite, React TypeScript, Electron; no dependencies.
**Spec:** docs/superpowers/specs/2026-11-11-agent-onboarding-design.md

## Global Constraints
- Preserve explicit policies, persona/model snapshots, causal/post-join visibility and remote approvals.
- Silence creates no assistant message/artifact; failures remain visible; no protocol JSON previews.
- No automatic agent reply loops, provider fallback, imported credentials or unrelated sessions.
- Onboarding analyzes only bounded owner-authorized workspace projections; adoption is explicit and idempotent.

## Review Focus
- Ambient turns, explicit mentions, paused/unavailable actors and malformed participation decisions.
- Snapshot/retry behavior while identities, models or membership change.
- Probe failures and interrupted onboarding cannot yield adoptable roles.
- Suggestions cannot invent evidence, targets or create duplicate identities on retries.
- Native route allowlists, copied modules and provenance remain in sync.

### Task 1: Group participation backend
Files: messenger.mjs, runtime.mjs, store.mjs and relevant server tests.
- [ ] Add failing tests for default auto delivery, reply/silence, attention facts, malformed output, manual/mention policies and snapshots.
- [ ] Implement structured local group participation, suppress envelope previews and preserve group context.
- [ ] Run targeted messenger/runtime tests; update legacy fixtures to explicitly request old policies when testing them.
- [ ] Report exact contract for UI and integrate.

### Task 2: Durable onboarding
Files: server/agent-onboarding.mjs and tests; server/index.mjs, narrow runtime dispatch hook and native route/build registration.
Interfaces: GET /agent-onboarding/context; POST /agent-onboarding; GET /agent-onboarding/:id; POST /agent-onboarding/:id/adopt; POST /agent-onboarding/:id/cancel.
- [ ] Write failing source-boundary, actual-probe, validation, recovery and idempotent adoption tests.
- [ ] Implement immutable bounded sources, two-phase local execution and queue integration; preserve tested model.
- [ ] Register routes and backend file in native copying/provenance/watch sets; verify tests.

### Task 3: Product UI and acceptance
Files: AgentOnboarding.tsx, Messenger.tsx, MessengerDialogs.tsx, types.ts, styles and docs, browser acceptance.
- [ ] Add auto participation controls, quiet completed state and clear group copy.
- [ ] Add local-backend selection, source toggles, progress/failure/cancel, grounded suggestion preview/adoption and reload recovery.
- [ ] Update API/client/product contracts; run host tests, TS/build, browser/native acceptance and real local Codex onboarding.
- [ ] Independently review, fix confirmed findings, create linked PR, verify latest-head CI and merge when gates pass; update Linear with actual evidence.
