# Local agent quick add and cards — GET-498

User confirmed the product direction and authorized phase one implementation: quickly add local agents and understand their cards. Later, friends will call an agent still running on its owner's computer. This phase does not implement remote accounts, pairing, sharing, transport or network exposure.

## Approach

Reuse the existing discovery, stable `agent_<backend>` contacts, SQLite, fixed Electron IPC and Messenger. A separate agent registry would duplicate identity and recovery. Automatically adding every installed backend would defeat explicit selection. Keep discovered backend records for configuration, but new records enter the address book only after explicit adoption. Existing records without an adoption field retain their old visibility; names, configurations and chats never change during discovery.

## Quick add

Welcome and contacts expose the same quick-add panel. Show installed candidates, login/configuration status and a small model summary. Allow selecting one or more supported installed local adapters (Codex, Claude Code, Pi); Gemini/OpenCode remain visible as unsupported, never advertised as executable. Addition is local only, does not run a model, install software, sign in, change global defaults or send a greeting. Unconfigured supported agents may be added, with honest setup status. Validate the entire selection before writing; repeated/concurrent addition returns the same stable contacts, preserving edited identities and existing chats. Save errors preserve the selection and retry identity. Refresh performs fresh local discovery and preserves still-valid choices.

New unadopted system contacts stay out of ordinary contacts, group pickers and new-chat/quick-chat suggestions, while remaining available as backend choices in the identity editor. Explicitly opening a legacy direct chat adopts its backend contact for compatibility. Previously saved contacts remain visible even when unavailable. After adding, offer a direct chat with the first selected contact; do not auto-send.

## Cards

Use one shared read-only card in contact details and the existing profile dialog opened from a chat header. Identity, owner (“我”), location (“这台 Mac” for local bindings), availability, description/role, next configured provider/model, model follow/fixed policy and thinking depth are visible. Label these as configuration, not proof of the actual model behind an arbitrary remote service. Unknown remote model remains service-managed/unknown. Capabilities derive only from fixed adapter facts: local chat, independent conversation context, supported text progress (Codex/Pi), stop; remote facts remain unknown. Do not infer intelligence scores or task expertise from the model name. Thinking depth is not a cross-model intelligence ranking.

Current adapters do not read account quota. Display “暂不可获取” and explain that identities sharing a backend account can share its quota. Never show zero, unlimited, prices, resets or balances without a real provider receipt. Discovery/profile reads do not spend tokens or invoke a quota probe. Snapshot timestamps describe configuration collection only. No raw config, paths, tokens, auth output, hostnames or private account identifiers go in the card.

## Phases

1. This PR: local adoption and cards, preserving roles, drafts and current conversations.
2. Later: authenticated same-owner device pairing, stable device/agent identity and explicit routing; offline/sleep shown honestly, no automatic backend switch.
3. Later: real friend invitation/acceptance and owner grants for independently isolated sessions, capability/usage limits, expiry and revocation. Credentials and owner histories stay with the owner. Only adapters explicitly supporting delegated use are eligible.

## Validation

Host tests cover new candidate vs legacy adoption, batch atomic validation, repeat/restart preservation, unsupported/missing/login/configuration states and API idempotency. UI acceptance covers welcome → selection → addition → chat, contact/profile cards, refresh, a narrow viewport, and console health in an isolated synthetic workspace. Real CLI login/limits/execution remain separately scoped. Type checks, personal suite, root applicable tests and independent review precede merge; latest-commit CI gates are required.
