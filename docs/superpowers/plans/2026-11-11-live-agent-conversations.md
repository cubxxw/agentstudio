# Live Agent Conversations Implementation Plan

> Execute inline using executing-plans and TDD; independent review before landing.

**Goal:** Reliable live follow-up chat with configurable, refreshed agent identities.
**Spec:** `docs/superpowers/specs/2026-11-11-live-agent-conversations-design.md`
**Architecture:** Keep SQLite runs and fixed IPC. Add safe CLI profile projection, immutable per-run configuration, parsed JSONL progress and causal message projection. Shared UI consumes the same facts.

## Constraints and review focus

No new provider, credential export, automatic model fallback, private transcript fixtures or second queue. Preserve old tasks, snapshots, approvals and drafts. Test late UTF-8 fragments, exit-0 error events, changed defaults while queued, follow-up context after a late predecessor reply, and cancellation/old progress events.

1. [x] Add RED tests for causal context and Pi/profile/stream behavior; implement safe `agent-profiles.mjs` metadata projection and local adapter. Register the new module in bundle/watch/receipt contracts.
2. [x] Resolve profiles during discovery and message acceptance; validate contact configuration and avatar, freeze execution snapshots including retries, emit throttled text/phase progress bound to the current run. Test no future/recipient leakage and no partial artifacts.
3. [x] Add contact identity/model/appearance controls and refresh; display detected and accepted model information. Replace aggregate run footer with stable per-question reply slots, queued indicators and real streamed Markdown; keep send available and stop precise.
4. [x] Polish avatars, bubbles, typography, Markdown and reduced-motion states. Add browser/native delayed-reply/configuration acceptance; inspect synthetic screenshots.
5. [ ] Run relevant full suites, independent review, actual configured CLI with synthetic prompts, CI-gated PR/merge, package and installed-profile readback; close GET-485 only after acceptance.

Defaults chosen by the implementer: follow-up queue is sequential, not an implicit interrupt; model defaults mean saved CLI startup defaults, not attaching to an existing terminal session. Existing runs retain their snapshot. No streaming API outside the owned runtime is introduced.
