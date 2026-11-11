# Group participation and role preparation acceptance

GET-490 · 2026-11-11 · [PR #13](https://github.com/cubxxw/agentstudio/pull/13).

## Verified behavior

- Default local group members receive the owner's message and return a validated reply or silence decision. Silent completion publishes no message/artifact. Explicit attention, member policies, accepted identities/models, retry and post-join boundaries remain covered.
- Role preparation uses the existing single worker queue. An actual configured-model challenge precedes analysis. Suggestions cite bounded current-workspace sources; optional group history excludes DMs. Habits remain labeled inference. Adoption creates one contact pinned to the tested configuration without joining groups.
- Queued/running cancellation, repeated requests, uncertain process stops, barriers that arise after queueing, and restart during cancellation are covered. UI continues reading progress while stop confirmation is pending. Generic hidden-thread mutations are rejected.

## Evidence

| Check | Result and scope |
| --- | --- |
| Personal backend | 98 tests passed sequentially, including 9 onboarding tests and 5 group-participation tests |
| Desktop unit tests | 116 passed |
| Core unit tests | 99 passed, 1 integration test skipped |
| Development/native registration tests | 13 passed |
| Go host tests | `GOMAXPROCS=2 go test -tags nocrypto ./...` passed; dependency downloads delayed the run |
| Type checking/builds | Personal and desktop TypeScript and production bundles passed; core declarations built |
| Synthetic browser | New journey: 6 checks passed, including narrow/dark reading. Existing messenger journey: 15 checks passed |
| Synthetic Electron | New journey: 5 checks passed through fixed native IPC and bundled worker |
| Real configured Codex in Electron | 5 checks passed: silence, attributed reply, probe before suggestions, reload, explicit adoption. Isolated synthetic groups/records only; no personal transcripts or remote accounts used |
| Independent review | Two P1 and two P2 findings fixed; isolated HTTP/worker checks and actual startup-order recovery verification passed. No unresolved P0/P1/P2 |
| PR/merge CI | Read the linked PR's latest head and merged revision independently; local test counts do not substitute for CI |

Artifacts and review reports are registered under `/private/tmp/ai-test-agentstudio-group-onboarding.YRAWBx`. The real model run is `onboarding-real-glAgah`; it is actual configured Codex execution, not a synthetic executor. Browser/native fixtures explicitly identify synthetic replies and suggestions.

The first broad parallel backend attempt encountered an existing SQLite lock-race assertion (`busy`, `busy`); its isolated retry passed. No fix to that unrelated test is claimed. The full `pnpm test` wrapper initially attempted to reinstall worktree dependencies and was stopped before its tests ran; the component commands listed above were executed separately using existing dependencies. Provider/credentials failures remain failures; there is no fallback provider or automatic onboarding replay.

This acceptance does not establish external-agent self-selected silence: remote submissions retain their exact approval path. Agent replies enter later visible context but do not recursively wake every member. Joining still does not grant earlier group history. The generated local Mac bundle is ad-hoc signed; notarized distribution is separate.
