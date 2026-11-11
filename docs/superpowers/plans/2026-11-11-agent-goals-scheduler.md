# Agent goals and scheduler implementation plan

**Goal:** Each agent can retain a goal, run on its own bounded schedule, and expose
editable settings from a quiet peer/group chat header.

**Architecture:** SQLite control records and one background scheduler feed the
existing PersonalWorker. Independent UI and discovery modules consume fixed
contracts; existing onboarding owns role analysis. No new dependencies or resident
processes. The approved local-contact design and scheduler design travel together.

**Execution:** Native implementation with independent UI/discovery tasks under the
dispatching-parallel-agents workflow; root owns shared backend integration and
types. Independent review of the final branch follows all integration tests.

1. Merge the prior contact-chat fix onto current origin/main, retaining GET-490
   group participation. Establish shared control types and isolated workspace.
2. Write failing behavioral tests for controls, daily/interval timing, coalescing,
   duplicate dispatch, per-contact independence, budget, changed identities,
   cancellation, recovery and autonomous next-run decisions. Implement
   server/agent-scheduler.mjs and narrow integrations in index/runtime/store.
3. In parallel, implement AgentProfile UI and Messenger/group entry points, plus
   a read-only host/discovery module and candidate UI. UI edits remain outside
   root-owned scheduler and server integration files.
4. Integrate discovery, control routes, module copy/watch/provenance and desktop
   IPC allowlist. Preserve current personas, chats, drafts and run snapshots.
5. Add deterministic browser/native acceptance: peer header → profile → goal and
   schedule → save/reload → run-now → actual fake reply → pause; group member
   configuration; narrow/dark/keyboard states. Check all relevant unit suites,
   personal/desktop builds and native runtime source readback.
6. Independent review, fix confirmed material findings, commit and create a PR
   linked to the task. CI, merge and actual app installation are separate states.

**Review focus:** stale queued work after pause, identity replacement before
dispatch, midnight/DST budget boundaries, restart duplication, malformed model
envelopes, update races that overwrite drafts, and falsely claiming isolation for
single-conversation web services.

**Rulings:** Default schedules are off. Local adapters support bounded autonomous
next-run decisions; remote chat adapters initially support interval/daily timing.
Cross-agent dispatch and OS wake scheduling are excluded by the confirmed scope.
