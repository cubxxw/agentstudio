# Grok Bot messaging and approval synchronization (GET-496)

The owner requested the complete Grok Bot flow, including approval synchronization, and authorized autonomous implementation and delivery. This change keeps the existing personal workspace, original account, and other bots. Live verification uses the dedicated `AgentRoom Approval QA 20261111` bot and harmless native choice cards.

The installed app currently fails to launch its login URL through the system browser. Native Grok Bot 0.79.4 and the configured public Cursor sign-in endpoints are reachable. PersonalServices also discards approval contents into `input-required`; it has no decision return path. Grok currently skips updates to older widget sequences, consumes a widget before its reply is confirmed, and can clear reply ownership while a card remains pending.

## Approach

Reuse the native Grok connector, the local authenticated A2A adapter, and the existing backend Decision/approval queue. An independent provider inbox projects current pending cards, including cards created before connection, into the bot's direct conversation. It creates no fake outbound run and imports no historical transcript. Linked task cards additionally resume the original run through `tasks/get` after a choice or external resolution. A separate renderer-to-provider approval IPC path would duplicate authorization and is unnecessary.

## Boundaries

- Main privately registers a native source with its owned worker after registering the corresponding connection. The backend cannot infer trusted sources from arbitrary remote metadata or renderer input.
- Fixed local operations list current approval records and respond to one exact card/version. Endpoint, credential version, instance, provider agent/session and card revision remain bound. The renderer receives labels and opaque local choice keys; original option values stay inside the adapter.
- A durable native ledger saves pending cards and choice dispatch state before any provider mutation. Repeated request ID/payload returns the existing receipt. Different payload, stale revision, different instance or unavailable provenance is rejected. Uncertain delivery is queried, never replayed.
- Grok polls structured answered/skipped metadata even when its sequence is old. Card disappearance, omitted bodies, network failure and stale pages do not prove resolution. Responding first refreshes the exact original card; an already resolved or revised card cannot accept an old action.
- Original-app decisions update the local card and processing source. A local click invokes only its explicit option. Existing pending cards outside an AgentRoom run remain inbox items, not invented executions. Unsupported device-permission surfaces retain a clear original-app action and status; no persistent permission is synthesized.
- The task's original message/nonce and phase survive pending approvals. Restarts rebuild proven pending state read-only; an interrupted send/answer remains unknown. No restart resubmits a message or choice.
- Approval synchronization runs in a bounded independent watcher so a waiting card does not occupy the global model worker. Ordinary send approval and MCP semantics remain unchanged.

## Verification

Tests cover raw option fidelity, local keys, original-app resolution, revisions, race-before-response, repeated clicks, missing acknowledgements, pending versus sending restart, account/session mismatch, partial text before a card, and a fresh final reply after resolution. Native UI acceptance covers login, contact registration, actual send/reply, inbox discovery, local choice readback, original-app choice cancellation, restart, and non-replay. Synthetic and live evidence stay distinct. Independent review and the applicable latest CI gate merge; the issue closes only after live acceptance.
