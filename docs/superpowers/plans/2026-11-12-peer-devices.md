# Device contacts implementation plan

Spec: ../specs/2026-11-12-peer-devices-design.md. The user requested implementation of the discussed approach; execute natively in this isolated worktree with an independent final review.

1. Add failing behavioral tests for desktop sharing and presence, using real isolated HTTP servers and injected local executors. Cover token rejection, exported identity, isolated history, duplicate request conflicts, restart and revocation.
2. Implement `DesktopSharing` in `apps/personal/server/desktop-sharing.mjs`: settings, private token storage, Tailscale listener, bounded manifest/A2A routes, isolated persistent task execution through the existing worker. Connect it to server startup/shutdown and fixed IPC routes; bundle the module.
3. Extend `RemoteNodes` to validate desktop manifests and Tailscale IPv4 HTTP origins, poll every 15 seconds, retain success timestamps and catalogs on failure, and project per-contact availability/activity. Test stale results, empty/withdrawn catalogs and check coalescing.
4. Add settings controls in `DeviceSharing.tsx`; reuse existing enrollment UI, rename it to devices, and support tailnet IP addresses. Add shared presence presentation to avatars, contact lists, details and conversation headers, with accessible status text and dark/reduced-motion styling.
5. Update API, architecture, client contracts and setup guide. Run focused and full host checks/builds plus two-device browser acceptance. Independent review, resolve P0/P1, create linked PR, pass latest CI, merge, package/install and verify the actual native build where possible. Keep the issue open if physical peer acceptance remains unavailable.

Review focus: remote requests cannot access private local transcripts or credentials; changing selection/revoking tokens cannot grant access to old tasks under new authority; peer imports cannot create forwarding loops; stale checks cannot resurrect removed devices; uncertain task outcomes never trigger duplicate execution.
