# Clients: screens, behaviour and test ids

## AgentRoom first-use and test mode

The empty chats home offers onboarding without blocking sidebar navigation or legacy links. Settings adds a 测试与引导 tab. Test profiles show a persistent mode label. Test-only reset rotates to a fresh profile; the normal workspace never has that reset button.

| Element | `data-testid` |
| --- | --- |
| Welcome / owner name | `workspace-welcome`, `workspace-owner-name` |
| Start / role setup / connect | `im-welcome-start`, `workspace-welcome-agents`, `workspace-welcome-connect` |
| Preferences / reopen | `personal-tab-testing`, `workspace-tools`, `workspace-reopen-welcome` |
| Enter / reset / return | `workspace-enter-test`, `workspace-reset-test`, `workspace-leave-test` |
| Persistent mode | `workspace-mode` (`data-test-mode`) |

`node dev/agentroom-acceptance.mjs` and `--native` cover welcome persistence, reopen, profile isolation and recovery using synthetic data. Details: [testing](personal/testing.md).

## Personal conversation workspace

The Mac Electron app opens the personal workspace by default. Its renderer shares `apps/personal` UI, uses the dedicated `window.agentStudioPersonal` preload and fixed IPC, and leaves API HTTP to its owned utility. It does not read the old session or start legacy connectors. Personal data belongs to the Electron profile's `personal` directory; the auxiliary web build has separate `.local/personal` data. See [setup](personal/README.md) and [the IPC contract](api.md#default-personal-desktop-ipc).

The existing native window and traffic lights remain. Closing hides it while work continues; Dock activation reopens it, and quit closes its utility. Native menu commands are New (`⌘N`), Search (`⌘K`) and Settings (`⌘,`). macOS Messages informs navigation and reading comfort; AgentRoom has its own [visual language](personal/visual-language.md). A quiet sidebar frames open, unboxed Agent replies, while deep slate-blue outgoing bubbles identify the owner's messages. Contact identity is aligned with the conversation toolbar. There is no top-left app logo. Narrow widths use a single list or chat with Back. Reload/deep links restore the selected chat. A save action opens the native dialog, then reports the saved artifact's byte hash.

| Messenger element | `data-testid` |
| --- | --- |
| App / navigation | `im-app`, `im-nav-chats`, `im-nav-contacts`, `im-nav-approvals` |
| New / settings / search / refresh | `im-new`, `im-settings`, `im-search`, `im-refresh` |
| List filters | `im-filter-all`, `im-filter-group`, `im-filter-agent`, `im-filter-human`, `im-filter-history` |
| Chat / contact / approval rows | `im-chat-<id>`, `im-contact-<id>`, `im-approval-<id>` |
| New conversation / group / contact | `im-welcome-start`, `im-new-group`, `im-new-contact`, `im-start-<contactId>` |
| Contact profile / start / edit | `im-contact-detail`, `im-start-chat`, `im-edit-contact` |
| Contact editor / fields | `im-contact-editor`, `im-kind-agent`, `im-kind-human`, `im-contact-name`, `im-contact-handle`, `im-contact-description`, `im-contact-backend`, `im-contact-instructions`, `im-contact-save` |
| Detected profile / model / thinking | `im-agent-options`, `im-detected-model`, `im-profile-refresh`, `im-model-options-toggle`, `im-model-policy`, `im-model-select`, `im-model-provider`, `im-model-name`, `im-model-thinking` |
| Explicit Pi identity / avatar choices | `im-extract-identity`, `im-avatar-icon-<icon>` |
| Live reply slot / partial / precise stop | `im-response-<runId>`, `im-streaming-message`, `im-run-stop-<runId>` |
| Group editor / name / members / policy | `im-group-editor`, `im-group-name`, `im-group-search`, `im-member-<contactId>`, `im-policy-<contactId>`, `im-group-save` |
| Conversation / contact information / create group | `im-main`, `im-chat-info`, `im-promote-group`, `im-back` |
| Messages / content / actions / running state | `im-timeline`, `im-message` (`data-contact-id`), `im-message-content`, `im-message-actions`, `im-reply-message`, `im-run-status` |
| Avatar / group sender profile | `im-avatar` (`data-avatar-source`), `im-message-avatar` |
| Composer / text / send / file / mentions | `im-composer`, `im-message-input`, `im-send`, `im-attach`, `im-mention-<contactId>` |
| Approvals / return | `im-pending-bar`, `im-approval-open-chat` |
| History / scratch / mode / recovery | `im-new-notes`, `im-send-options-toggle`, `im-task-mode`, `im-task-connection`, `im-send-recovery` |
| Results / records / artifacts | `im-results`, `im-conversation-details`, `im-artifact`, `im-execution-record` |
| Rail / list / skip | `im-rail`, `im-list-panel`, `im-skip` |
| Focus reading / reveal list | `im-focus-toggle` (`aria-expanded`, `aria-controls`) |

Every personal conversation uses this Messenger shell, including old `?workspace=tasks&thread=…` links and scratch drafts (`?thread=new`). The old workspace parameter is removed without replacing the shell. Historical threads retain their IDs, mode/connection and draft recovery keys; no message is sent during migration. The conversation title opens its contact/group information; the single `im-results` information button opens result versions and execution records. `im-new-notes` continues the old unsent scratch draft or starts local organization. Native New Chat opens the conversation picker.

Completed replies display their Markdown content without a sender name, model, per-message time, delivery checkmark or original-artifact link. Direct replies have no repeated avatar; groups retain an avatar button with the sender's accessible name and hover title. Incomplete replies, local-only human delivery and actionable run states remain visible. Reply/copy tools appear on hover or keyboard focus; touch devices give them a separate row. Day separators and sidebar update times remain orientation aids. Normal connected status and composer keyboard hints are omitted. Focus mode hides the whole sidebar; its toolbar button and shortcuts reveal it before changing screens.

Automatic avatars use bundled official images for Codex/ChatGPT, Claude, Pi, Gemini CLI and OpenCode. Agent identities use rounded square portraits; human contacts remain circular. Native personal-service identities use the existing catalog's exact connection ID to select Grok Bot, Muse, Dots or Cue images; display names are never used to guess a provider. Explicit custom icons and colors remain user-owned. Unknown contacts use name initials. Assets load locally without external avatar requests or changes to the renderer CSP. Brand provenance lives in `packages/brand/README.md`. These are product marks, not a claim that a provider verified a persona or supplied a live per-agent portrait.

Above 760 CSS pixels, the sidebar button or `⌘\` (`Ctrl+\` off Mac) hides the list for focused reading. The preference survives reload. Search (`⌘K`) and rail navigation reveal it again; collapsing from inside the list moves keyboard focus to its toggle. Dialogs keep these shortcuts inactive. At 760 CSS pixels and below, the normal list/chat Back flow takes precedence, so a saved focus preference never removes navigation. Navigation uses neutral materials; the macOS personal window uses native sidebar vibrancy that follows window activity, while the reading pane stays opaque. Reduced transparency uses solid surfaces, reduced motion disables transitions, and increased contrast strengthens text and selection. See the [design reference and implementation order](personal/macos-design.md).

The shared reader, connection preferences and decision cards retain these IDs:

| Element | `data-testid` |
|---|---|
| Decision / approve / reject | `personal-decision`, `personal-decision-approve`, `personal-decision-reject` |
| Reader / save / font / save receipt | `personal-reader`, `personal-reader-download`, `personal-reader-font`, `personal-save-receipt` |
| Modal / close / tabs | `personal-modal`, `personal-modal-close`, `personal-tab-connections`, `personal-tab-memory`, `personal-tab-about` |
| Connection / fields / save | `personal-add-connection`, `personal-connection-name`, `personal-connection-type`, `personal-connection-url`, `personal-connection-save` |
| Optional Bearer disclosure / password field | `personal-connection-auth-toggle`, `personal-connection-token` |
| Memory / save | `personal-memory-input`, `personal-memory-save` |

`node dev/messenger-acceptance.mjs` tests contacts and direct/group replies, including remote chat without per-message approvals. `node dev/conversation-acceptance.mjs` tests legacy links, exact pending-request migration, creation-response races and historical tools. Both accept `--native` after desktop build, use isolated profiles and synthetic data; the history fixture uses the existing mock keychain switch only for its fresh test profile. `node dev/personal-connect-synthetic.mjs --synthetic` also exercises two direct Muse chat turns through the real native connector against the existing fake service, while retaining an explicit Cue task approval. The complete reading/connection/browser edge checks use the same Messenger IDs.

## Retained Matrix clients

`AGENTSTUDIO_WORKSPACE=matrix` selects the original desktop renderer and `window.agentStudioDesktop` preload. The IDs and contracts below remain unchanged. In this mode, desktop (Electron) and mobile (Expo) implement the same flows on top of `@agentstudio/core`. E2e tests select elements only by `data-testid`. On React Native the same strings go in `testID`, which react-native-web renders as `data-testid`. The `data-*` attributes below (`data-room-name`, `data-sender`, `data-own`, `data-step-type`, `data-network`, `data-state`) go in react-native-web's `dataSet` prop, so the mobile web build renders the same attributes as desktop (native ignores `dataSet`). The ids below are a contract: do not rename them. Run the cross-client stack suite with `AGENTSTUDIO_WORKSPACE=matrix pnpm test:e2e`; isolated desktop smoke also explicitly selects Matrix mode.

## Startup and configuration

- Server URL comes from these sources, in order:
  - desktop: env `AGENTSTUDIO_SERVER_URL`, then the saved setting, then the default `http://127.0.0.1:18090`
  - mobile: `EXPO_PUBLIC_AGENTSTUDIO_SERVER_URL`, then the same default
- The session (refresh token, matrix credentials) is persisted:
  - desktop: in the Electron `safeStorage`-encrypted file, accessed through preload
  - mobile native: `expo-secure-store`
  - mobile web: `localStorage`
- E2e uses a fresh profile directory or storage each run. Set `AGENTSTUDIO_USER_DATA_DIR` on desktop.

## Screens

### Sign in

| Element | `data-testid` |
|---|---|
| Email input | `signin-email` |
| "Send code" button | `signin-send` |
| Code input | `signin-code` |
| "Sign in" button | `signin-verify` |
| Error text | `signin-error` |

On success the app opens the inbox.

### App shell

| Element | `data-testid` |
|---|---|
| Inbox nav | `nav-inbox` |
| Approvals nav | `nav-approvals` (shows pending count badge `nav-approvals-badge`) |
| Tasks nav | `nav-tasks` |
| Connect nav | `nav-connect` |
| Settings nav | `nav-settings` |

On mobile, these are bottom tabs with the same ids. The chat is a stack screen inside the Inbox tab, so the tab bar stays visible in a chat; leaving the Inbox tab returns it to the chat list, and opening a chat from a chat replaces it (at most one chat is mounted).

### Inbox

| Element | `data-testid` |
|---|---|
| Filter tabs | `inbox-filter-all`, `inbox-filter-agents`; mobile also has `inbox-filter-people` (the Mac app has no People filter for now) |
| List | `chat-list` |
| One row per room | `chat-row` with attribute `data-room-name="<name>"`. On RN the row also has `accessibilityLabel` = the name and a nested `chat-row-name` element with the name. |
| Unread badge in a row | `chat-row-unread` |
| Network label in a row | `chat-row-network` (e.g. "Demo", "Agent") |
| Empty state | `inbox-empty` with a "Connect an account" button `inbox-connect` |

- Rows are sorted by last activity.
- Agent rows show the agent status text (`chat-row-status`) and a "Needs you" marker (`chat-row-needs-you`) when the agent has pending approvals.

### Chat (room view)

| Element | `data-testid` |
|---|---|
| Header with name | `chat-title` (inside `chat-identity`, which also holds the avatar) |
| Connect step that asks for a value (the Cue API key) | `local-login-input`, `local-login-submit`, `local-login-input-error`, `local-login-link` |
| Connect screen: a service's card / its agents button / summary | `local-service-card-{id}`, `local-service-manage-{id}`, `local-service-summary-{id}` |
| A service's agents sheet (rows, close, check for new agents) | `local-sheet`, `local-connector-row`, `local-sheet-close`, `local-sheet-add` |
| Extra button while a connect step waits (e.g. "Use an API key instead") | `local-login-action-{id}` |
| "Waiting on you" row above the list (desktop, All only; agents with a pending approval or at work) | `agent-waiting`, `agent-waiting-item`, `agent-waiting-more` |
| Agents needing attention: banner, its button; a row's status ("Sign in again") | `agent-trouble`, `agent-trouble-fix`, `chat-row-status` |
| One-time note about agents on this Mac | `local-mode-note`, `local-mode-note-ok` |
| Message parts: an image / a file an agent sent; "In Grok Bot" under what the user wrote in the service's app | `message-image`, `message-file`, `message-via` |
| Settings: export diagnostics | `settings-export-diagnostics` |
| Delete a chat (desktop) | `chat-menu` → `chat-delete` → `chat-delete-confirm` (leaves and forgets the room) |
| Notifications from an agent (desktop, agent chats) | `chat-menu` → `chat-notify-all`, `chat-notify-approvals`, `chat-notify-mute` (`role="menuitemradio"`, the current one has `aria-checked="true"`) |
| A real picture in an avatar (person's or agent's own) | `avatar-image` |
| A person's initials, when they have no picture (agents never show initials) | `avatar-initials` |
| Network label | `chat-network` |
| Timeline | `timeline` |
| Each message | `message` with attributes `data-sender` (display name) and `data-own="true\|false"`. On RN, testID `message`. |
| Message body | `message-body` |
| Composer input | `composer-input` |
| Send button | `composer-send` |
| Failed send | `message-failed` |
| Back to the chat list (mobile only) | `chat-back` |

Opening a message's actions (hover menu on desktop, long-press on mobile) shows "Ask an agent" `message-ask`. The mobile web build also shows a small always-visible `message-ask` button beside each askable message, since long-press is awkward with a mouse.

**Approval card** (rendered for a `com.agentstudio.approval` message):

| Element | `data-testid` |
|---|---|
| Card | `approval-card` |
| Title | `approval-title` |
| Details rows | `approval-detail` |
| Choice buttons | `approval-choice-<key>`, e.g. `approval-choice-book` |
| State after decision | `approval-state`, text "Approved: Book" / "Declined: Don't book" / "Expired" |
| Countdown | `approval-expiry`, e.g. "44 min left" |

**Drafts card** (for `com.agentstudio.drafts`):

| Element | `data-testid` |
|---|---|
| Card | `drafts-card` |
| Each draft | `draft-item` |
| "Use" button per draft | `draft-use` |

"Use" opens the origin chat with the draft text placed in its composer, editable and not auto-sent. When the user sends it, the client calls `POST /v1/tasks/{id}/sent`.

### Ask an agent (modal or sheet)

| Element | `data-testid` |
|---|---|
| Agent picker | `ask-agent-<agent name>`, e.g. `ask-agent-Concierge` |
| Request input | `ask-request` (default "Draft a reply") |
| Context preview: up to 5 lines (anchor + 4 prior) with checkboxes | `ask-line` + checkbox `ask-line-toggle` |
| "Don't ask again for this agent" | `ask-dont-ask` |
| Send | `ask-send` |
| Cancel | `ask-cancel` |

- The preview is skipped when the agent's consent says `ask_without_preview`.
- Lines from senders known only by a phone number or email are shown already anonymized (`Person 1`).
- After sending, the app navigates to the agent's chat.

### Approvals screen

| Element | `data-testid` |
|---|---|
| List of pending approvals | `approvals-list` |
| Each approval | an `approval-card` (same component as in chat) |
| Empty state | `approvals-empty` |

### Tasks screen

| Element | `data-testid` |
|---|---|
| Board | `tasks-board` |
| Columns | `tasks-col-pending`, `tasks-col-answered`, `tasks-col-done` |
| Each task | `task-card` with `data-state` |

### Connect

| Element | `data-testid` |
|---|---|
| Network section heading (desktop) / network card (mobile) | `network-<id>`, e.g. `network-demo`, `network-agentstudio-agents` |
| Flow "Connect" button | `flow-<id>`, e.g. `flow-concierge`, `flow-endpoint`, `flow-demo`. On desktop the login runs in a sheet that closes itself 1.5 s after `login-complete`. |
| Login step renderer | `login-step` with attribute `data-step-type` |
| `user_input` fields | `login-field-<id>` |
| Submit | `login-submit` |
| QR / code display | `login-qr`, `login-code` |
| Complete message | `login-complete` |
| Connected accounts list | `connection-row` with `data-network` and `data-state`, plus a remove button `connection-remove` |

### Settings

| Element | `data-testid` |
|---|---|
| Account email | `settings-email` |
| Server URL | `settings-server` |
| Sign out | `settings-signout` |
| Version | `settings-version` |
| System notifications switch (desktop) | `settings-notifications` (a checkbox) |
| Notifications per agent (desktop) | `settings-agent-notify`, one `<select>` per agent with `data-agent-name="<agent name>"` and the values `all`, `approvals`, `mute` |

## Behaviour rules

- **Auto-join:** the client auto-joins invites from bridge bots and ghosts on its own homeserver (see `matrix-events.md`).
- **Hidden rooms:** management rooms with a bridge bot are hidden.
- **Pending approvals:** the badge refreshes when a `com.agentstudio.approval` event arrives, and every 15 s while the app is visible.
- **Sending:** sends are optimistic. On failure the message shows `message-failed` with a retry.
- **Ask anonymization:** handled in `@agentstudio/core` (`buildAskQuote`), so both apps behave the same.

## Notifications and the Dock badge (desktop only)

`@agentstudio/core` decides what to notify (`NotificationCenter` in `notifications.ts`); the renderer hands each notification to the main process through the preload (`agentStudioDesktop.notifications`), which shows it and keeps the settings in `settings.json`.

- **What:**
  - a new approval: the approval's title, with the agent's name as the body; it opens Approvals
  - an agent's reply: the agent's name and the start of the message; it opens the chat
  - an agent that needs a new sign-in or has an error (its connector on this Mac, or an agent reported offline): it opens Connect
  - a message from a person: the chat's name and the message; it opens the chat
- **Priority:** approvals make a sound and stay where the platform allows it. Agent replies and problems are normal notifications. People's messages are silent, and a newer one replaces the older one from the same chat.
- **When not:**
  - nothing from the first sync, and nothing older than 2 minutes when it arrives, by the event's own timestamp (bridge backfill, imported history, catch-up after sleep)
  - edits (`m.replace`)
  - nothing about the chat (or, for approvals, the Approvals screen) the user is looking at in a focused window
  - own messages and bridge bot notices
- **Settings:** a master switch (`settings-notifications`, on by default) and a mode per agent: all notifications, approvals only, or mute (`settings-agent-notify`, or `chat-notify-*` in the chat menu). They are saved by the main process and survive a restart. macOS asks for permission with the first notification; if nothing was shown yet, turning the switch on or the first badge count shows one "Notifications are on" notification so it asks (the Dock badge needs the permission too).
- **Dock badge:** pending approvals plus unread messages in agent chats, the same numbers as `nav-approvals-badge` and the agent rows' `chat-row-unread`. At 0 the badge goes away.
- **Background:** on macOS, closing the window hides it, so the app keeps syncing and notifying until the user quits.
- **Tests:** with `AGENTSTUDIO_TEST_NOTIFICATIONS=1` the main process records notifications and the badge in `globalThis.__agentStudioNotifications` (`{ shown, badge, click(i) }`) instead of showing them; e2e reads them with `electronApp.evaluate`.

## Agents on this Mac (desktop only)

This is a section of the Connect screen for agents connected through the user's own session, running in the Mac app (`docs/connectors.md`).

| Element | `data-testid` |
|---|---|
| Section | `local-agents` |
| Service cards | `local-service-<id>`, one each for `local-service-grokbot`, `local-service-muse` and `local-service-dots` |
| Connect-flow panel | `local-login` |
| Flow status text | `local-login-status` |
| Cancel | `local-login-cancel` |
| Error | `local-login-error` |
| Choice buttons (e.g. which Grok bot) | `local-login-choice-<id>` |
| Connector rows | `local-connector-row`, with `data-service` and `data-status` (`ready`, `starting`, `needs_login`, `error`) |
| Row buttons | `local-connector-open` (shows the service's own window), `local-connector-remove` |

Connecting signs in to the service:

- **Grok Bot:** in the browser.
- **Muse and Dots:** in an AgentRoom sign-in window.

The app then registers the connector with the agents bridge. After that the agent is a normal contact on every client, but it answers only while the Mac app runs.

Approval cards from connectors use the choice keys the connector sends:

- **Grok Bot:** the widget's values.
- **Page buttons:** `b<index>`.

### Agent onboarding and autonomous group participation

| Surface | `data-testid` |
| --- | --- |
| Contacts / new-chat entry | `im-onboarding-open`, `im-new-onboarding` |
| Preparation dialog | `im-onboarding`, `im-onboarding-agent`, `im-onboarding-goal` |
| Source controls | `im-onboarding-context`, `im-onboarding-recent`, `im-onboarding-memories` |
| Start/progress/cancel | `im-onboarding-start`, `im-onboarding-status`, `im-onboarding-cancel`, `im-onboarding-result` |
| Suggestions/adoption | `im-role-suggestion`, `im-adopt-role` |

The default member policy is `auto`; completed silent runs create no chat bubble. Their reasons remain in execution details, and model failure is never displayed as a silence decision. Explicit member policies remain selectable through `im-policy-<contactId>`.

### Contact profiles, goals, schedules and local discovery

The quiet `im-chat-info` header displays the peer/group and status (`im-header-status`), without model metadata. Clicking a peer opens an in-place profile; clicking a group opens group information. Inspecting member configuration does not change membership. Profile/basic editors preserve the underlying chat, draft and reading position.

| Surface | `data-testid` |
| --- | --- |
| Profile entry / root / basic editor | `im-agent-profile-open`, `im-agent-profile`, `im-agent-basic` |
| Per-member profile | `im-member-profile-<contactId>` |
| Goal / status / control state | `im-agent-goal`, `im-agent-goal-status`, `im-agent-control`, `im-agent-state` |
| Schedule fields | `im-agent-schedule-enabled`, `im-agent-schedule-mode`, `im-agent-schedule-time`, `im-agent-schedule-timezone`, `im-agent-schedule-interval`, `im-agent-schedule-limit` |
| Capability / timing | `im-agent-unsupported`, `im-agent-autonomous-hint`, `im-agent-next-run`, `im-agent-last-reason` |
| Mutations / recovery | `im-agent-save`, `im-agent-run-now`, `im-agent-pause`, `im-agent-unsaved`, `im-agent-error`, `im-agent-reload`, `im-agent-notice` |
| Run history / system trigger | `im-agent-history`, `im-agent-run-<runId>`, `im-agent-run-open-<runId>`, `im-schedule-event` |
| MCP explicit planner | `im-contact-chat-backend`, `im-contact-chat-backend-hint` |
| Discovery entry / body / contact | `im-discovery-entry`, `im-host-discovery`, `im-discovery-contact` (`data-contact-id`), `im-discovery-open-<contactId>` |
| Discovery actions / state | `im-discovery-refresh`, `im-discovery-retry`, `im-discovery-empty`, `im-discovery-more`, `im-discovery-prepare`, `im-discovery-connect`, `im-discovery-details` |

Schedules start disabled. Run Now requires a saved active goal. Pause turns off later scheduling and invalidates queued ticks; it does not claim to stop an operation already sent. Save conflict/network errors preserve editing. App exit and Mac sleep suspend scheduling. Fixed remote schedules do not claim structured autonomy. Human contacts remain local-only until an actual messaging transport exists.

### Shared artifact coauthoring (personal desktop)

The `im-nav-library` entry opens the independent artifact library. `library-artifact-<artifactId>` opens the same work across chats. Discussion cards use host-owned records, with `creation-card`, `creation-scope`, `creation-approve`, `creation-adjust`, `creation-edit-goal`, `creation-save` and `creation-reject`. A decision binds the displayed version; approving an old card fails rather than executing a changed plan.

`artifact-tool-activity` lists actual scoped tool operations. `artifact-permission-card` with `artifact-permission-approve/reject` grants or denies a precise extra scope. `artifact-result-card`, `artifact-open`, `collaboration-stop` and `collaboration-retry` show real contributions and partial/unknown outcomes. Collaboration runs do not expose ordinary chat retry controls.

The `artifact-workspace` contains `artifact-revision-select`, tabs `artifact-tab-preview/files/history/activity/permissions`, isolated `artifact-preview`, `artifact-file`, `artifact-file-content`, `artifact-editor`, `artifact-edit-save`, `artifact-revision`, `artifact-accept`, `artifact-restore` and `artifact-archive`. Native actions use `artifact-reveal` and `artifact-export`. Sharing uses `artifact-share`, `artifact-share-thread`, `artifact-share-paths`, `artifact-share-follow` (unchecked by default), `artifact-share-confirm`, `artifact-share-notice` and `artifact-share-revoke`. Human Finder changes appear in `artifact-local-warning` and are preserved until explicitly coordinated.
