# Contact conversations implementation

1. Replace the old A2A group approval expectation with regression tests for direct
   sending, natural replies and idempotent followups; prove they fail first.
2. Snapshot accepted contact transport identity privately, preserving it on retry.
   Dispatch contact chat through the existing A2A executor without creating a
   decision. Keep existing approvals, MCP calls and task forwarding unchanged.
3. Verify scoped group context, endpoint/credential changes, unknown submissions
   and read-only reconciliation. Update API and user documentation together.
4. Run the affected suites/build and desktop acceptance in an isolated profile;
   obtain independent code review, fix material findings and record limitations.

Review focus: a client must not opt a task/tool call into chat authorization;
queued/retried messages must not adopt a replacement endpoint or credential;
uncertain sends must never be repeated. Friend networking and host recommendations
remain explicit future scope.
