# GET-498 local Agent quick add and cards

2026-11-11. Phase one only. Multi-computer pairing and friend calls are planned, not implemented. No installation or replacement of the user's running AgentRoom bundle is included.

## Implemented

- Welcome and contacts share a multi-select local picker. Supported installed adapters can be added even when login/configuration needs attention; unsupported adapters stay visible but unselectable.
- Adoption retains stable system contacts and direct chats, never starts a model or sends a greeting. Batch validation and the existing SQLite idempotency transaction protect retries/concurrency.
- New candidates stay out of normal address books/member suggestions. Legacy contacts without the flag remain visible, preserving edited identities and prior conversations. Acceptance fixtures explicitly seed legacy identities where the old journey tests require them.
- Contact details and the chat-header profile share next-message model/thinking, location, own-use scope, fixed local adapter capabilities, and honest unavailable quota. No balance, reset, intelligence score or remote model is invented.

## Evidence

Host: Apple M4 Mac mini, macOS; reused workspace dependencies, serialized checks. Browser plugin unavailable; existing Playwright with isolated headless Chrome was used. Native acceptance launches this branch's Electron build with an isolated profile and a synthetic CLI that only answers version/login probes; it does not execute real model requests.

- Backend baseline: 27 tests passed before changes. Adoption/lifecycle, whole-batch rejection, legacy visibility and restart tests were observed failing before implementation and then passing.
- UI regression was observed failing on the former welcome UI (missing `workspace-welcome-local`), then passing after integration.
- Synthetic browser: welcome → select Codex + signed-out Pi → add → open empty chat → shared profile card; added contacts and chat persist on reload, unsupported Gemini remains outside contacts, fresh discovery does not duplicate identities. 1280×900 and 390×844; no recorded app console/page errors.
- Synthetic native Electron: welcome → select Codex → add → open empty chat → profile card → reload → contacts/refresh; fixed preload/IPC route exercised. Same viewport coverage and no recorded app console/page errors.

Temporary detailed evidence: `/private/tmp/ai-test-get-498.Lk4L7a` (browser `ui-green`, native `native`). This location is local evidence, not a portable repository artifact. Retained receipts and screenshots: `~/.local/share/agentroom-release-evidence/get-498/20261111`.

## Validation results

- Personal host suite: 139 passed; desktop: 150 passed; core: 99 passed and 1 environment-gated integration test skipped; dev scripts: 14 passed. Go `go test -tags nocrypto -p 2 ./...` passed.
- Personal TypeScript/build, core build and desktop Node/web TypeScript/build passed. Existing large-chunk/dynamic-import and Node experimental-SQLite warnings remain.
- Existing synthetic messenger (18 checks), onboarding (6), profile controls, live conversations (9), macOS design and welcome journeys all passed serially.
- Actual host discovery at 2026-11-11 19:27 Asia/Shanghai reported installed/configured/executable adapters for Codex, Claude Code and Pi; Gemini/OpenCode were absent. This was read-only discovery and no model call, so it proves neither live provider execution nor available quota.

## Independent review

Read-only whole-branch review found no P0/P1 and three concrete P2 issues. All three were reproduced before fixes: failed chat opening closed its saved-result panel; MCP contacts hid their explicit local chat backend facts; repeated acceptance reused completed onboarding. Fixes preserve the picker on failed chat opens, derive card facts from the effective chat backend while retaining tool-service identity, and create a unique child evidence workspace for every run. Regression tests passed afterward, including two browser runs using the same evidence parent and native Electron. The intentional synthetic HTTP 503 is retained in receipts separately from unexpected console errors (none).

## Limits

No real provider execution, live account quota, recurring schedule, third-party sharing, paired computer, friend invitation, production network transport, signed packaging or installed-bundle acceptance is claimed. Model names in the UI receipts are synthetic. Existing personal connection and tool approval boundaries remain separately scoped.
