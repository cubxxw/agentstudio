# Shared Artifact Coauthoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a group discussion with real Codex and Pi into one approved, versioned local artifact, and continue it in a second group.

**Architecture:** A shared server tool kernel owns grants, proposals, steps, content and revision commits. Codex uses a per-run stdio MCP proxy and Pi an explicitly loaded extension; both call the same authenticated local broker. Fixed desktop IPC serves cards, library and opaque revision previews.

**Tech Stack:** Existing Node ESM/SQLite, React/TypeScript/Electron, native CLI executors; no Docker or additional model provider.

**Spec:** `docs/superpowers/specs/2026-11-11-artifact-coauthoring-design.md`

## Global Constraints

- Preserve existing personal profiles, legacy Markdown artifacts, unrelated checkouts and services.
- First deliverables: Markdown and static HTML/CSS/JS, 256 files/32 MiB, 1 MiB per text file.
- Default execution: one model process, 30 minutes, 24 steps, 200 tool calls; new scope needs a new decision.
- Stable artifact identity; immutable revisions; pinned sharing by default; revoke at every read/write/dispatch.
- Preserve selected backend/model snapshots; no model/provider fallback or synthetic completion claims.
- User approved implementation in this chat; routine implementation choices do not require another permission round.

## Review Focus

- A changed brief must invalidate an otherwise disjoint implementation contribution (Task 2).
- A narrower work context must never flow into a wider group reply or tool card (Tasks 3/4).
- Removing a member must stop late commits and quarantine pending contributions (Task 3).
- A yielded parent must free the only process slot before its delegated child starts (Task 3).
- Head persistence and Finder materialization must preserve concurrent human edits (Task 2).

---

### Task 1: Native tools and bounded executor sessions

**Files:** Create `apps/personal/server/agentroom-tool-proxy.mjs`, `agentroom-pi-tools.mjs`, `tool-sessions.mjs`, `tool-sessions.test.mjs`; modify `local-agents.mjs`.

**Interfaces:** `ToolSessions.open(context, tools, handler)` returns `{endpoint,token,close}`; `executeLocalAgent({toolSession,...})` exposes only the approved catalog and emits authoritative tool events. Protocol adapters do not implement business policy.

- [x] Write tests exercising stdio initialize/list/call, denied tokens, malformed/oversize calls, actual argument/identity binding, and closure.
- [x] Run `node --test apps/personal/server/tool-sessions.test.mjs`; expect missing-module RED.
- [x] Implement the authenticated loopback broker, MCP JSONL proxy, Pi extension and trusted executor configuration. Disable inherited executable tools in this mode; fail closed on unsupported capability setup.
- [x] Run the same tests; expect PASS. Probe real Codex and Pi against synthetic tools, preserving their configured models; save actual outcomes.
- [x] Commit the tool transport and executor boundary.

### Task 2: Immutable artifacts and contribution integration

**Files:** Create `artifact-store.mjs`, `artifact-store.test.mjs`.

**Interfaces:** `ArtifactStore(store)` provides `create`, `read`, `stage`, `submit`, `candidate`, `commit`, `materialize`, `resolveLocal`; revisions contain file hashes and parent references. All mutations receive trusted actor/grant context.

- [x] Write behavioral tests for preapproval denial, stale file hashes, path/link escapes, changed mandatory input, full-candidate checking, head CAS, restart, and manually edited current trees.
- [x] Run `node --test apps/personal/server/artifact-store.test.mjs`; expect RED.
- [x] Implement bounded content-addressed objects, immutable manifests, separate staging, verified candidate commits, and recoverable materialization.
- [x] Run the task tests; expect PASS and preserved human bytes in the collision cases.
- [x] Commit the content/version subsystem.

### Task 3: Proposals, grants and collaboration scheduling

**Files:** Create `artifact-tools.mjs`, `creation-service.mjs`, `collaboration-runtime.mjs` and corresponding tests; modify `store.mjs`, `messenger.mjs`, `runtime.mjs`.

**Interfaces:** `CreationService` owns draft/ready/decision records and audience grants; `CollaborationRuntime` owns durable steps and checkpoints; `artifactTools(context)` returns the shared catalog; `callArtifactTool(context,name,args,callId)` checks scope and idempotency before work.

- [x] Write tests for two proposals joining one intent, version-bound approval, denial/duplicate clicks, participant binding changes, pinned sharing, blocked future heads, group audience intersection, member removal and single-slot yield/delegation.
- [x] Run the new creation/runtime tests; expect RED.
- [x] Implement the shared intent, canonical plan decisions, scoped grants, DAG/checkpoints, read fingerprints, late-callback protection and minimal safe group notifications.
- [x] Integrate conversation-tools for capable local agents without keyword routing; native calls and reply/silence remain distinct. Preserve existing tests through the compatibility path.
- [x] Run new tests plus existing messenger/group participation/local adapter tests; expect PASS.
- [x] Commit the durable collaboration flow.

### Task 4: API, desktop IPC and lifecycle

**Files:** Modify `index.mjs`, `apps/desktop/src/shared/personal-api.ts`, personal desktop contract, Electron main/worker and `electron.vite.config.ts`; create fixed-route/lifecycle tests.

**Interfaces:** `/api/library/artifacts`, `/api/creation-proposals`, `/api/collaborations` expose only opaque IDs; native artifact protocol reads checked revision files with a host CSP and no preload. Profile status includes collaboration blockers.

- [x] Write tests for strict IPC routes, content authorization, candidate previews, canceled tokens, restart/exit and profile-switch blocking.
- [x] Run the relevant personal/desktop tests; expect RED.
- [x] Implement the routes, opaque preview protocol, change notifications, owned shutdown and copied backend module registration.
- [x] Run those tests and the native registration test; expect PASS.
- [x] Commit desktop integration.

### Task 5: Cards, independent library and revision workspace

**Files:** Create `CreationCard.tsx`, `ArtifactLibrary.tsx`, `ArtifactWorkspace.tsx`, related styles; modify `Messenger.tsx`, `ConversationTimeline.tsx`, `ConversationDetails.tsx`, `types.ts`, `docs/clients.md`.

**Interfaces:** Cards consume server-owned proposal/status data, never model-generated executable HTML. Workspace reads an explicit revision, shows preview/files/history/permissions and links another group through an owner decision.

- [ ] Add the agreed test IDs and browser acceptance assertions for one shared card, actual approve/reject, isolated preview, library reopen and cross-group link/update.
- [ ] Run the acceptance flow against the pre-change UI; expect missing-element RED.
- [ ] Implement the views using the current visual language, narrow-window layout, keyboard focus and honest partial/failure states.
- [ ] Run type checks and deterministic native/browser acceptance; expect PASS, screenshots and no relevant renderer errors.
- [ ] Commit the user flow.

### Task 6: Real evaluation, docs, independent review and delivery

**Files:** Create `dev/artifact-coauthoring-acceptance.mjs`, explicit `--real` path and acceptance report; update architecture/API/desktop docs/roadmap and this plan.

- [ ] Run exact synthetic regressions for permissions, conflicts, recovery, audience boundaries and main chat compatibility.
- [ ] Run real Codex + Pi in an isolated profile; require two genuine tool contributions, one approved plan, an openable website, a second-group revision and persisted reopen.
- [ ] Run the applicable personal/desktop checks, native registration and latest-head CI; report any limits separately from observed successes.
- [ ] Obtain an independent whole-branch code review; fix confirmed P0/P1 with reproduction tests and rerun affected checks.
- [ ] Update PR #18 around final implementation, link Linear if service access recovers, and merge only after applicable current-head gates pass. Preserve incomplete work and evidence if externally blocked.

## Plan self-review

All spec sections map to the six tasks. Transport details are confined to Task 1; persistent identities and tools share a single kernel in Tasks 2/3. Tasks 4/5 consume server-owned state rather than recreating policy. The five Review Focus cases have explicit owning tests. The first real executor feasibility result is a gate for claiming that native tools work, not a substitute for the final group evaluation.
