# @agentstudio/desktop

The macOS Electron app opens the personal workspace by default. It preserves the existing `hiddenInset` window, traffic lights, draggable regions and Mac menus. One conversation owns its progress, decisions and Markdown results. The original Matrix inbox is retained with `AGENTSTUDIO_WORKSPACE=matrix`.

## Build and run the Mac app

From the repository root, with Node 22.13+ and pnpm installed:

```sh
pnpm install --filter '@agentstudio/desktop...' --frozen-lockfile
pnpm --filter @agentstudio/core build
pnpm --filter @agentstudio/desktop build
pnpm --filter @agentstudio/desktop start
```

The default personal mode needs no Go, Postgres, Synapse or bridge startup. Model work uses the existing configured Codex CLI; deterministic local organization and the explicitly synthetic sample work without a model. A missing executor or provider limit remains a blocker rather than generating a substitute result.

| Command | Scope |
| --- | --- |
| `pnpm dev:desktop` | Native Electron development entry; personal mode by default |
| `pnpm --filter @agentstudio/desktop build` / `start` | Build `out/`, then run the bundled local-file renderer |
| `pnpm package:mac` | Build a local ad-hoc Mac bundle; acceptance and distribution remain separate |
| `pnpm --filter @agentstudio/desktop typecheck` / `test` | TypeScript checks and desktop unit tests |
| `pnpm --filter @agentstudio/desktop e2e:smoke` | Retained Matrix smoke suite; explicitly selects Matrix mode and needs the old stack |

Electron is pinned to 45.2.1. Its postinstall download is allowed by the workspace configuration. If the binary is missing, run `node node_modules/electron/install.js` from this directory. A developer may use an existing proxy with `ELECTRON_GET_USE_PROXY=1` for that command; this does not change the binary version or checksum source.

## Runtime ownership and storage

In a built app, `out/renderer/personal/index.html` is a trusted local file, loaded with the dedicated `out/preload/personal.js`. Its only native bridge is `window.agentStudioPersonal`. It exposes fixed JSON API routes, change notifications, menu commands, native artifact saving and explicit runtime restart. There is no renderer API for arbitrary URLs, headers, files or shell commands, and the personal renderer cannot use the legacy session/connector IPC.

The main process starts one owned `utilityProcess` from `out/main/personal/worker.mjs`. The four backend ESM files are copied there unchanged. The utility uses Electron's bundled Node/SQLite, binds to a random loopback port and reports an ownership/workspace handshake. Main forwards only allowlisted `/api` requests to that exact child. Production `connect-src 'none'` keeps API HTTP out of the renderer; development additionally permits its own Vite origin for HMR. Backend CORS is not broadened for file pages.

Data defaults to `~/Library/Application Support/AgentStudio/personal`:

- `personal.sqlite` with WAL stores conversations, queues, decisions and results.
- `worker-lock.sqlite` holds the single-worker OS lock for that workspace.
- `vault/master.key` and `vault/credentials/` hold the personal Bearer file vault.
- `workspaces/` contains the per-run CLI working directories.

The app never discovers or attaches to port 18740, imports `.local/personal`, or reads/migrates the old Matrix session on default startup. Explicit data-directory overrides are for deliberate workspace selection and isolated tests; an already-owned directory fails closed rather than attaching to another process.

Closing a Mac window hides it, so its utility can continue. Reopening the app reuses that window. Quit requests a graceful close of this owned utility; a bounded forced exit requires the same PID, creation time, Utility type and service name to match. Unknown remote effects remain unknown after recovery. One unexpected crash may restart the utility automatically; it does not replay a POST. Concurrent restart requests coalesce, a later shutdown supersedes an older restart, and a fresh explicit restart can begin a new lifecycle generation.

Messages sent during execution are saved as followup runs. Each run reads only through its own input message; later requirements do not silently change an already approved payload. New input invalidates an unapproved preview, and unresolved remote execution prevents the followup queue from crossing it. See [the backend contract](../personal/server/README.md).

## Local macOS packaging

```sh
pnpm package:mac
```

`package-mac.mjs` stages only built files and a minimal package descriptor, then invokes the pinned packager for the current Mac architecture. It targets `apps/desktop/dist` by default, prints the bundle path, verifies its local signature and writes `build-receipt.json`. `AGENTSTUDIO_MAC_OUTPUT` selects a separate output directory. `ELECTRON_ZIP_DIR` may point to a directory containing the pinned official Electron archive; the script checks its SHA-256 before reuse.

Signing uses the ad-hoc identity `-`, without Hardened Runtime and with only the JIT entitlement. The script reads the resulting signature flags and entitlements back. It does not discover a Developer ID identity, notarize, publish or claim Gatekeeper distribution acceptance. The local `.app` has been launched and checked for package-owned runtime, saved CLI/MCP history and export hashes; the packaged native smoke also passed. Exact versions, retry history and limits are in the [macOS acceptance ledger](../../docs/personal/macos-acceptance.md). A successful build alone is not that acceptance.

Vite embeds the Git HEAD with `-dirty` when there are uncommitted files; an unavailable Git identity is `unknown-source`. The native health response includes that build reference, four backend file hashes and the bundled personal UI-entry hash. `PERSONAL_BUILD_REF` is an explicit test override. A clean merged-source rebuild is required before labeling a bundle with the merge revision.

## Configuration

| Variable | Scope |
| --- | --- |
| `AGENTSTUDIO_WORKSPACE=matrix` | Select the retained Matrix renderer and connectors; otherwise personal mode |
| `AGENTSTUDIO_USER_DATA_DIR` | Override Electron's whole profile; tests should use an isolated directory |
| `AGENTSTUDIO_PERSONAL_DATA_DIR` | Explicit personal backend workspace override; no automatic migration |
| `AGENTSTUDIO_CODEX_BIN` | Explicit local Codex executable; provider/login configuration stays with that CLI |
| `AGENTSTUDIO_PERSONAL_EXPORT_DIR` | Task-scoped test destination instead of a native save dialog |
| `PERSONAL_BUILD_REF` | Explicit runtime provenance override for controlled tests |
| `AGENTSTUDIO_SERVER_URL` | Matrix mode only: server URL before the saved setting, default `http://127.0.0.1:18090` |
| `AGENTSTUDIO_MOCK_KEYCHAIN=1` | Isolated legacy tests use Chromium's mock keychain |
| `AGENTSTUDIO_TEST_NOTIFICATIONS=1` | Legacy tests record notifications instead of showing them |

The `PERSONAL_PORT`/`PERSONAL_DATA_DIR` settings belong to the standalone web server, not the native host's automatic port/profile selection.

## Credentials and actual controls

Personal Bearer credentials use an AES-256-GCM **file vault, not Keychain**. The key and encrypted records are 0600, directories 0700, and both must be protected in backups. This does not isolate other processes running as the same OS user. Different tokens at the same endpoint remain separate connection identities; a private identity/version binding prevents an old approval from changing accounts. The displayed label is user-entered, and `identityVerified` remains false. OAuth, arbitrary authentication headers and general remote account proof are not implemented.

The CLI uses its configured provider and tools. Its requested read-only shell mode, separate working directory and task prompts do not enforce a mandatory sandbox over every preconfigured tool or plugin. A saved artifact hash proves byte consistency; a successful remote response does not independently prove an external side effect. Only approved material goes to the selected remote service; no browser-session or legacy token import is performed.

## Retained Matrix mode

```sh
pnpm dev:up
AGENTSTUDIO_WORKSPACE=matrix pnpm dev:desktop
```

This path retains `out/renderer/index.html`, `out/preload/index.js`, `window.agentStudioDesktop`, its safeStorage session and original connectors. Its renderer's network CSP stays scoped to the configured server origin. The stack commands still manage the legacy `.local/` services; they do not reset the native personal profile. Full cross-client legacy E2E uses `AGENTSTUDIO_WORKSPACE=matrix pnpm test:e2e`.

Setup, current evidence and explicit gaps: [personal guide](../../docs/personal/README.md), [macOS acceptance](../../docs/personal/macos-acceptance.md), [Mac decision record](../../docs/personal/macos-decision.md), [historical web acceptance](../../docs/personal/acceptance.md).
