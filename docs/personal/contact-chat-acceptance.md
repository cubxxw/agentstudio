# Contact chat acceptance · 2026-11-11

Ordinary A2A contact messages now share the direct/group conversation flow with
local agents. The previous executor treated every message as a proposed remote
task and generated a decision; new contact sends instead retain a private
transport identity at acceptance. Legacy tasks, existing pending decisions, MCP
tool calls and service-originated decisions keep their explicit confirmation.

## Local evidence

All data below was synthetic, in isolated profiles. No real model, service account,
private transcript or installed production profile was used.

| Check | Result |
| --- | --- |
| Regression before implementation | Both new direct/group tests failed with `needs_input` instead of `completed` |
| All personal backend tests | 92 passed, zero failed/skipped |
| All desktop unit tests | 115 passed, zero failed/skipped |
| Stack/native registration tests | 13 passed, zero failed/skipped |
| Personal TypeScript and Vite build | Passed |
| Desktop main/renderer build and all three TypeScript configs | Passed |
| Actual Electron Messenger journey | 15 checks passed; direct remote group reply, no approval card or reply disclaimer, fixed IPC, owned utility, drafts, zoom and zero renderer exceptions |
| Actual native service journey | 40 checks passed; four simulated sign-ins, an explicitly approved Cue task, two direct Muse chat turns, restart persistence, no resubmission, zero renderer exceptions |
| Independent code review | No reproducible production P0/P1/P2; 25 focused tests passed, plus forged-input and legacy-pending-decision boundary checks. One P2 in the new native test was corrected to use a distinct marker per turn |

The first intermediate backend run caught an error-message compatibility assertion;
the binding-change wording was corrected. A new disconnect fixture initially
destroyed the already-consumed request rather than its response; correcting the
fixture made the transport failure observable. Final suites passed after these
changes; these were resolved failures, not unchanged flaky retries. Review also
caught that the native two-turn test shared one marker; distinct turn markers now
reject accidentally reusing the previous reply, and the full native service
journey was rerun with that stronger assertion.

Dependencies were reused from the existing checkout after the offline store lacked
packages and registry downloads failed. Builds/typechecks/tests used the existing
local package executables, avoiding pnpm's automatic dependency reinstall. SQLite
experimental and existing Vite config warnings remain; they did not fail checks.

The native Muse test used the real WebChat connector, personal-service A2A host,
preload and utility against `e2e/fakes/agents.ts`. Both direct chat turns produced
their correlated `Muse echo:` responses without decisions. The main-process
manifest contained exactly one completed Cue task and two completed Muse chat
tasks, with unchanged IDs after restart. This verifies the adapter path with fake
provider data, not current live Muse website/account compatibility.

## Scope

Endpoint/credential changes block queued sends and retries. Unknown sends remain
unreplayable across restart/cancel/retry; task reconciliation uses the original
task ID and read-only `tasks/get`. New group members receive only post-join context.
Remote chat provenance and artifact verification stay in execution records.

Human contacts remain local-only. Friend requests and host-status-driven agent
configuration recommendations are design direction, not implemented capabilities.
This evidence does not establish a merged revision, CI result, installed app update
or live account acceptance.
