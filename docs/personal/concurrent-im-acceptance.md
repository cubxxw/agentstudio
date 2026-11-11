# Concurrent IM reading acceptance — GET-505

The owner approved independent group reading, persona-based text/reaction/silence, and an IM silence setting. Delivery, model input and acknowledged completion are separate facts. The implementation uses three bounded invocation slots by default; actual shared service sessions and each agent's follow-ups retain order.

## Verified behavior

- Gated server tests cover overlapping independent members, same-member order, isolated progress/cancellation, slot reuse, accepted remote URL barriers, legacy/contact crossing, and original-task read-only reconciliation.
- Participation tests cover reaction output without phantom messages/artifacts, owner add/remove and idempotency, settings versions and accepted policy snapshots, same-input peer context, failed output, post-join visibility, membership removal/rejoin, and final artifact authorization. Read-only reconciliation preserves the exact originally submitted input receipt.
- A real CreationService negative control proves that artifact dependencies carried by a reaction propagate to a later reader; revoking sharing then prevents that reader from publishing.
- Tool broker startup is single-flight and closing during startup leaves no listener. Approved artifact creation steps remain exclusive while ordinary group reads overlap.
- Browser and actual Electron journeys each pass: fast reaction/silence while a peer remains running, no queued reply bubbles, owner reaction add/remove, IM default/group override, reload persistence, acknowledged readers and no renderer exceptions. Browser also covers a 460px viewport.
- Existing synthetic Pi streaming journey passes nine checks, including partial text, follow-up ordering, model snapshots, stop, failure, dark/narrow/reduced-motion UI and no renderer exceptions. Desktop unit tests pass 203 checks in 25 files; personal and desktop TypeScript checks pass.
- Real configured Codex (`gpt-6.1-sol`, existing `openai` provider) ran two isolated synthetic roles. They started at `2026-11-11T14:37:59.043Z` and `14:37:59.053Z`; one returned reaction `✅`, the other silence. Both completed with acknowledged input receipts; no text messages or document artifacts were fabricated. No provider switch or real chat source was used.

## Evidence and limits

Formal local evidence is preserved under `/Users/cubxxw/.local/share/agentstudio-evidence/get-505-concurrent-im/`. Browser plugin was unavailable; validation used the repository's Playwright workflow and isolated Electron profiles. The real-model check is a bounded execution check, not a long-running provider/reliability benchmark. Remote services retain ordinary text compatibility and only structured-compatible contact chat can produce native silence/reaction outcomes. No new Matrix/mobile transport, external side-effect permission or autonomous agent wake loop is introduced.
