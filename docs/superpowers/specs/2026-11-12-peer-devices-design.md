# AgentRoom devices and contact presence

The owner authorized implementation after discussing remote agents and confirmed that both Macs can install AgentRoom on their existing Tailscale network. Both installations retain their own workspace. Either installation can explicitly share selected Agent contacts; another installation adds the displayed address and private access token and sees those contacts with device provenance, online state, and direct/group chat support.

## Approach

Reuse the existing RemoteNodes enrollment and durable A2A messageId/taskId handling. Add a distinct, authenticated desktop sharing listener bound only to a locally assigned Tailscale IPv4 address. This works with the owner's existing tailnet without requiring new HTTPS certificates or Serve configuration. HTTPS `.ts.net` headless nodes remain supported. SSH tunnels were considered for initial experiments but need extra setup; exposing the full desktop API or synchronizing SQLite would expose unrelated workspace state and conflict with the current single-owner engine.

## Sharing contract

- Sharing defaults off. Settings show this device, a name, selected Agent contacts, the Tailscale address, and enable/disable controls. An explicit reveal action returns a private access token for transfer to the other installation. Credentials are encrypted in the existing vault and excluded from ordinary responses and database documents.
- Share the directory of locally owned Agent contacts. Only local CLI bindings execute remotely; personal service contacts remain directory-only until provider-side session isolation exists. Exclude human contacts, self, imported node contacts, unbound contacts, and tools without a chat backend. Never relay imported peers back into their source.
- Export only public contact identity and availability/activity counts. Keep role instructions, model settings, credentials, local chat history, explicit memories, and artifacts on the host. Each incoming message creates an isolated host-side execution conversation; only its supplied context enters that run. The host's selected contact persona/configuration controls execution.
- Discovery uses `agentroom-node/1` with `kind: desktop`; arbitrary stable contact IDs and same-origin `/agents/{contactId}` endpoints extend the existing CLI-only manifest. Requests require the token, reject browser origins, unknown paths, non-tailnet peers, oversized bodies and arbitrary methods. The loopback desktop API remains unchanged.
- A2A messageId is the durable taskId. Repeated same-content sends return the original task; changed-content reuse fails. Persist the hidden host conversation before dispatch. Result polling never resends a message. Restart/cancel uncertainty remains visible. Disabling sharing stops remote access without killing accepted work; ordinary re-enable preserves the token and generation for recovery.
- The app owns the listener: closing its window retains sharing; quitting stops it. Test workspaces have their own disabled-by-default sharing setting and unique identity. Missing Tailscale addresses fail closed without affecting normal local use.

## Presence

Poll enrolled node manifests every 15 seconds, coalesce concurrent checks, and notify the UI. Successful observations update `lastSeenAt`; failures show reconnecting for at most 60 seconds after the last success, then offline. Never treat a persisted reachable snapshot as permanently online after restart. Authentication/identity changes show attention and cannot silently rebind credentials. Failed checks preserve the last catalog; missing contacts become withdrawn.

Contact presence is independent of configuration availability and per-conversation run status. Project online/reconnecting/offline/attention plus device name, lastSeenAt, running count and pending approvals. Local contacts expose configuration readiness honestly; no quota or inference promise. Avatars show a small static dot; list/detail/header include text, device name and accessible labels. Busy and waiting-for-approval remain online activity states. Support reduced motion and dark mode.

## Verification and delivery

Exercise two isolated personal servers with real loopback HTTP: selected contact enrollment, persona execution, no unrelated data exposure, idempotency, wrong tokens, changed authority, withdrawal, restart, stale presence, disable/re-enable, workspace switching, listener bind races and lost receipts. Check desktop IPC allowlist, bundled backend files, builds and full host tests. Review independently before merge. Produce a Mac build and documented connection steps. A physical MacBook pairing is a separate acceptance claim until the actual second machine participates.
