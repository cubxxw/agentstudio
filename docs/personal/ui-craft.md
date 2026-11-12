# Everyday interface details

The messenger keeps its existing Mac shell, palette and conversation model. This
pass improves scanning and reduces the scrolling needed to find configuration.

## Decisions

1. Conversation, contact, approval and artifact rows share a 68 px minimum height,
   with 40 px contact portraits. Names retain ellipsis; dates do not shrink.
   Today's conversations show a time, yesterday shows “昨天”, and older entries
   show a date (including the year when needed). The complete timestamp is available
   on hover and in the semantic `time` element.
2. Contact identity sits beside a 72 px portrait, above the existing actions. The
   configuration card uses as many 170 px columns as the available width permits,
   so model, provider and thinking settings can be compared on one row at desktop
   widths. Long handles wrap, and values remain selectable. Model configuration
   and unknown quota retain their existing factual meaning.
3. Preferences use a persistent category list with an independently scrolling
   content panel. Below 641 CSS px, categories become a horizontally scrollable
   row. Arrow keys and Home/End select and focus categories; Tab enters the panel.
4. Connection shortcuts jump directly to this Mac, personal Agents, remote servers
   or tools. Only the content panel scrolls; the jump offset includes the actual
   wrapped shortcut height and panel padding. The heading receives focus without
   scrolling the surrounding dialog.
5. Providers with more than two instances collapse into a count and management
   disclosure. Instances requiring attention remain counted in the summary.
   One or two instances keep their actions directly visible. Long instance names
   take at most two lines; the full name remains in the title and accessible text.
6. Switching navigation sections starts the new list at its top. Switching contacts
   starts their detail at the top. Conversation drafts and stored history retain
   their existing ownership. Quick-start names cannot push their action offscreen.
7. The library distinguishes no saved work from a search with no matches. Clearing
   search returns keyboard focus to the search input. Its welcome surface explains
   selecting existing work or creating a first work through group discussion. The
   creation shortcut opens a new group without carrying over the last private
   conversation's participant.
   Long work titles keep the header compact, with the full title on hover. At
   narrow widths the version selector gets its own row above Finder and export.
8. The native About, Hide and Quit commands explicitly display AgentRoom. They
   retain Electron's native roles and the existing Safe Storage identity.

9. Approval requests stay compact at four lines, with an inline disclosure only
   when text overflows. The keyboard-operable control stays above the request so
   it remains easy to collapse after expansion. Its state resets per approval.
10. Draft attachments show a bounded filename and file size, with separate preview
    and removal actions. Long names cannot push removal outside a narrow composer.
    Long attachment lists scroll within a bounded composer area, keeping Send visible.
    Preview opens the existing reader, restores focus on close and leaves the draft
    intact. Numbered accessible labels distinguish duplicate filenames.
11. Group mention suggestions follow the caret at the end of the text. Arrow keys
    select, Enter adopts the selected handle, and a later Enter sends. Escape hides
    the current suggestions; Shift+Enter inserts a newline. Composition Enter
    keeps its existing input behavior. The textarea exposes the active list option
    without moving keyboard focus out of the composer.

## Validation

`node dev/ui-craft-acceptance.mjs` builds on the existing Electron acceptance
pattern. Build the desktop first; set `AGENTROOM_CRAFT_EVIDENCE_DIR` to a registered
artifact directory. `--baseline` captures the earlier layout without expecting the
new behavior.

It uses isolated profiles, synthetic contacts and local text organization. A
test-only replacement of the isolated app's service IPC handler supplies three
synthetic service instances; no provider is called. Checks cover disclosure,
attention counts, removal from three to two instances, keyboard navigation, draft
continuity, list scroll reset, long handles, light/dark renderer media, 200% zoom
and exactly 320 CSS px. PNGs include renderer and macOS window captures when the
OS capture is available. The existing messenger and macOS design journeys remain
the regression checks for chats, approvals and saved results.

The library checks cover empty/search states and their group entry. After the
isolated Electron process exits, the script seeds a committed Markdown document
with the existing artifact store, then reopens the same isolated profile to check
the populated library, search recovery and actual file readback. It does not seed
or modify a workspace while its worker owns the database lock.

These checks do not establish VoiceOver, real-provider login, physical input-device
acceptance, signing/notarization or installation into the user's running app.

For a previously built Mac bundle, set `AGENTSTUDIO_PACKAGED_APP` to its `.app`
path; `AGENTROOM_EXPECTED_BUILD_REF` optionally asserts its runtime source ref.
`AGENTROOM_CRAFT_INPUT_TRACE=1` records a bounded input/composition/storage trace
only in the runner's asserted isolated synthetic profile. A failed run writes
`failure.json` before taking its failure screenshot, including the draft checkpoint,
focused control and recent events. Only the composer records text input; other
controls retain focus metadata and navigation keys. The trace is opt-in because
instrumentation can change timing; the added draft checkpoints can also change
scheduling even when tracing is off. A passing run does not repair or explain an
intermittent failure by itself. Batched Chromium storage writes do not establish
UI event order, and trusted input events can come from test automation.


`node dev/composer-details-acceptance.mjs` covers the follow-up composer and
approval details. Set `AGENTROOM_DETAILS_EVIDENCE_DIR` to an absolute registered
artifact directory, build the desktop first, and optionally use
`AGENTROOM_DETAILS_APP_DIR` for a staged build. The shared launcher checks its
revision and source fingerprint. `AGENTSTUDIO_PACKAGED_APP` supports a built Mac
bundle. `--baseline` requires an explicit clean `AGENTROOM_EXPECTED_BUILD_REF`.

The check uses an isolated synthetic profile and disabled local CLI execution.
It verifies mention selection/send order, Escape, wrapping, caret movement,
Shift+Enter and Chinese composition; long/duplicate attachment preview, removal,
focus and reload persistence; and expanded approval requests at desktop and
320 CSS px. A localhost sentinel verifies that the pending approval never sends
a provider request. Screenshots record light/dark and increased-contrast states.
These are renderer checks, not physical keyboard or VoiceOver acceptance. Failure
screenshots are eligible only after the runner verifies its isolated profile.
