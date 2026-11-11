# Group avatars (GET-508)

The owner asked for designed group icons and user customization, and explicitly asked us to get on with implementation. The following defaults are design decisions for this change.

Replace the shared outline of two people with a small illustrated room of overlapping conversation cards. It uses the same quiet green as AgentRoom, rounded corners and strong contrast at sidebar sizes. Offer six motifs (room, inspiration, code, exploration, nature, coffee) and five muted colors. Existing groups get the new default without a data migration.

The group information form shows a live preview, motif buttons, color choices, a local picture picker and Restore Default. A chosen PNG, JPEG or WebP is center-cropped to a square locally, normalized to a bounded PNG and stored only when the form is saved. Cancel discards the draft. The same avatar appears in the list, pinned shortcuts, header, empty conversation and group editor.

## Approaches

- Member mosaics identify a roster but change with membership and duplicate individual portraits.
- Generated art can be expressive but introduces model cost and a network step into changing a group setting.
- A designed default plus editable motifs/colors and local pictures fits the existing group form and works offline. This is the chosen implementation approach.

## Contract

`ThreadSummary.groupAvatar` is optional/null for the automatic default, `{kind:'preset', icon, color}` for a selection, or `{kind:'image', dataUrl}` for a picture. The server accepts only known motifs/colors and structurally bounded square PNGs of at most 256×256 and 96 KiB. The UI accepts source files up to 5 MiB, validates raster magic bytes before decoding, removes source metadata through canvas and falls back to 128×128 if necessary. No SVG, remote URL, additional filesystem route, CSP expansion or image request to an agent is added.

Avatar edits use existing group version checks and request idempotency. They leave members, membership visibility, messages, runs, decisions and provider identities intact. Reset changes only `groupAvatar`. Failed decoding retains the prior draft. A broken historical image falls back to the default. Picker controls have accessible names, selection state and existing dialog keyboard behavior.

Verification covers API validation, persistence/restart, summaries, optimistic conflicts, cancel/reset, source-file errors, same-avatar rendering on all surfaces, narrow and dark views, an isolated packaged Mac profile and preservation of the normal workspace during installation. The existing AgentRoom bundle name, green app icon, stable signing and Keychain/data identities must be preserved.
