# Server agents over Tailscale

The personal desktop currently owns one SQLite workspace. A2A can call an existing
remote service, but AgentRoom cannot yet publish a server's installed agents or
enroll that server as a coherent node. The owner asked for implementation, with
autonomous local/remote setup under the working agreement.

## Approaches and decision

1. Replicate desktop databases: enables multiple desktop clients, but introduces
   conflicting transcripts, credentials and scheduling ownership. Outside this change.
2. Central hub with outbound workers: useful for unsolicited server events and
   dispatch while clients are absent, but requires exposing the Mac and a new queue protocol.
3. **Selected by implementer: one authenticated A2A node per server.** Reuses the
   current contact, group, approval and reconciliation paths. Tailscale Serve
   provides private HTTPS in front of a loopback process. No Mac API is exposed.

## Contract

- Node IDs are random persistent identities, not hostnames or hardware IDs.
  Explicitly enabled Codex/Claude/Pi agents are enumerated by an authenticated
  `/.well-known/agentroom-node.json` manifest. Node names are display metadata.
- A per-node random bearer is generated in a private state directory. It is never
  printed by the server, included in discovery, or sent to another origin. The
  Mac stores each connection credential in its existing encrypted vault.
- A single node-add form enrolls its agents atomically. Repeated enrollment does
  not duplicate contacts. An existing origin with a different node ID or token is
  rejected; changing authority requires removing the old connections first.
- A2A `message/send` persists task input before returning. `messageId` is the
  durable task ID; an identical replay returns the same task, changed input
  conflicts. `tasks/get` is scoped to the selected agent. A task is serialized
  with all other tasks on this node to bound shared server resources.
- Mac records the node's predictable task ID before sending. Lost responses can
  be reconciled with GET-by-ID without resubmitting. This guarantee is only for
  explicitly enrolled AgentRoom nodes; generic A2A behavior stays unchanged.
- Queued tasks resume after an orderly exit with confirmed child termination.
  Running tasks interrupted by node exit become unknown and never rerun automatically.
  Unexpected process death or unconfirmed child stop persistently fences the queue
  until operator reconciliation. Finished results survive restarts. Availability
  checks are timestamped observations, not proof of account quota or execution.
- CLI commands/cwd/model/provider are never supplied by network clients. The
  node uses its own installed, authenticated CLI and a dedicated cwd, preserving
  existing execution limits. No credentials or private transcript migration.
- Binding is loopback only. HTTPS public URL must be a Tailscale DNS name;
  loopback HTTP is allowed for isolated tests. No Funnel and no Serve reset.
- User-facing section supports adding/checking a node and individual connection
  removal through existing protections for running/unknown work.

## Raft source evidence

Read-only source at `db5e399f017d584e49597e3a28757645d6807893`:
`packages/daemon/src/hostIdentity.ts` separates stable host identity from display;
`packages/server/src/routes/daemon.ts` authenticates computers before connecting;
`packages/daemon/src/runtimeOutcomeOutbox.ts` and the existing
[research](../../personal/research/raft-observation.md) distinguish persisted
outcomes from transport delivery. These motivate independent implementation, not
source copying. Raft is FSL-1.1-ALv2. This feature is not Raft consensus or HA.

## Acceptance

Cover authentication/origin/size boundaries, atomic multi-agent enrollment,
duplicates and changed credentials, per-agent task isolation, lost first reply,
queue recovery and interrupted work. Run personal and desktop checks, independent
review, and a real tailnet server execution. Real model/account failure is a
separate acceptance result; never substitute synthetic output for it.

Mac still owns conversations, requires an active app to dispatch/poll, and is a
single availability dependency. Multi-desktop synchronization and unsolicited
server-initiated messages remain outside this delivery.
