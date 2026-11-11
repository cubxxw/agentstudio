# Grok Bot avatars

GET-499, 2026-11-11. The scope is each Bot's avatar, not image attachments in chat.

## Observed cause

The installed Grok Bot 0.79.4 still returns `avatar_shape` (protobuf field 6), `avatar_color` (7) and optional `avatar_url` (9) from `ListGrokBotAgents`. Most Bots use a locally rendered character rather than a photo URL.

AgentRoom's old extractor assumed fixed minified exports. In 0.79.4, the old eye-layout export is a React hook; offline extraction failed with `Cannot read properties of null (reading 'useState')` and fell back to the service icon. Separately, personal-mode IPC exposed only the service identity, so even a working connector avatar could not reach the personal contact list.

## Implementation

- Select the installed client's pure body mapping, palette lookup and still-image renderer by their function signatures. Do not execute arbitrary exports to discover a match. Unfamiliar or ambiguous modules retain the service-icon fallback.
- Run only the common/platform rendering modules in a hidden sandboxed, offline window. Import no account, session or full application module. Rasterize the locally produced SVG into a PNG, using no redistributed character paths or client implementation.
- Keep masks and colors under the owning personal-service profile. Cache by profile and installed-client version, regenerate older/incomplete caches, and allow only known shape names.
- Personal IPC returns a bounded PNG data URL, generated in main from the connector's photo or rendered character. Provider addresses and credentials stay in main. The renderer accepts only bounded PNG data URLs and uses the service logo when unavailable.
- Avatar loading runs in the background, with one in-flight lookup per instance. Catalogs and open/remove controls do not await images. A changed image emits one normal renderer invalidation; stopped or removed instances discard late results.
- Contacts, chat lists, headers, contact cards and group replies use the Bot image in automatic-avatar mode. An explicit persona icon keeps precedence. Historical replies resolve the original run's connection, so rebinding a contact cannot substitute another Bot's image.

No backend chat data or credentials are migrated. Chat attachments retain their existing behavior.

## Local acceptance

After installing the workspace dependencies, use a registered artifact directory:

```sh
AGENTSTUDIO_AVATAR_EVIDENCE=/absolute/artifact/directory \
  node dev/grok-avatar-acceptance.mjs --installed-app
```

This uses the installed Grok Bot only as an offline renderer. It never signs in or calls the service. It checks distinct violet/blob, orange/square and green/heart PNGs, profile isolation and owned-window cleanup. The old implementation was observed failing this check; the replacement passes on 0.79.4. These facts do not by themselves prove installed AgentRoom UI acceptance.

Unit coverage checks image propagation through personal services, bounds and SVG rejection, original-connection attribution and explicit icon precedence. Native UI and final installed-build results are recorded in the delivery evidence and Linear issue.
