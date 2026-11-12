# Native service identity and delivery recovery

GET-514 fixes a shutdown race: a delayed Grok token refresh or transcript poll could call persistence after the connector map was cleared. Saving that empty map deleted `connectors.bin`, including Muse records. This mechanism matches the observed missing file, but does not identify the exact callback that caused the incident.

The manager now stops ordinary Grok RPCs and polling, retains all records until already accepted, bounded token rotations finish and persist, and then seals writes before releasing records. A stopped client cannot refresh again. Late Grok/WebChat reads cannot publish changes or reopen the service window.

The main process sends an owner-bound, private service snapshot to its own utility: bridge port, process start time, safe instance summaries and ledger IDs/states. No prompt, token, arbitrary endpoint, provider diagnostics or credential-export API is exposed. The worker accepts native ownership only from a live instance, an identity-matching saved owner registration, or an original task receipt plus its frozen transport identity. A matching loopback address alone is insufficient.

Native contact readiness reflects the observed instance. Missing or unavailable instances do not receive new messages. Service identity and the last bounded PNG survive disconnection, and group errors identify their original Bot. Historical reply avatars resolve the original connection rather than a rebound contact. Explicit custom icons retain precedence. Muse can capture its persona video even when the page title omits its name.

For an `unknown` dispatch without a task ID, the intact native ledger can recover the original receipt. Absence proves non-dispatch only for failures from a previous process generation and the same frozen connection identity: this adapter durably records a stable message ID before provider dispatch. Such a request becomes `failed/not_sent`; its text, other group runs and original identity are preserved. Current-process timeouts, changed transports, unrelated local servers and missing owner evidence remain uncertain. Recovery never calls `message/send`. Unknown results without a receipt offer connection settings rather than an unusable task query.

A missing credential file cannot be recreated from identity metadata or avatars. Original browser partitions and conversations are preserved. Restoring sign-in and verifying the exact Bot/account are separate from deterministic shutdown, recovery and UI acceptance; do not claim real-account delivery until that readback succeeds.
