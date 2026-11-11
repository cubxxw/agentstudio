# Group portraits — GET-508

Groups use an illustrated green conversation room by default. Group information offers six motifs, five colors, local PNG/JPEG/WebP pictures and Restore Default. Local pictures are center-cropped and normalized before saving; Cancel leaves the stored portrait unchanged. The same descriptor is rendered in the list, pinned shortcuts, header, empty conversation and editor preview.

## Verification

- API regression tests first reproduced ignored avatar metadata and acceptance of unsupported values. Avatar plus existing Messenger tests subsequently passed 24 tests.
- The personal backend suite passed 259 tests, with one pre-existing skipped integration test.
- Core, personal and desktop TypeScript checks and both renderer builds passed.
- The isolated browser journey passed motif/color selection, all saved portrait surfaces, PNG center crop, bounded serialization, reload, cancel, invalid/oversized/disguised files, JPEG/WebP conversion, late-reader selection and close races, reset and preservation of membership/messages/runs/decisions. Light, dark and 390×844 screenshots were inspected.
- An additional regression retains populated historical messages, accepted execution snapshots and a pending approval through preset, image and reset edits. The four avatar API tests pass.
- The packaged Mac journey passed nine checks, including a custom picture restored after a full process restart. Its userData path is asserted before test data is created. The bounded texture fallback and console capture also passed the updated nine-check browser journey.
- Independent read-only review found no P0/P1 or confirmed production defects. The populated-history case above closes its test-coverage observation. Final merged-build and installed-owner readback are recorded in the GET-508 delivery comment. Browser testing uses the existing Playwright setup because the Browser plugin is unavailable.

The API validates a bounded square PNG container. Images have no remote URL, and portrait data is excluded from model conversation snapshots. Existing version conflict and idempotency checks protect edits. Synthetic journeys use isolated profiles and test pictures; formal screenshots and receipts stay outside Git.

## Reproduce

After building personal and desktop, run `node --test apps/personal/server/group-avatar.test.mjs` and `node dev/group-avatar-acceptance.mjs`. Use `--native` and `AGENTSTUDIO_PACKAGED_APP=/path/to/AgentRoom.app` for an isolated packaged test. Set `AGENTROOM_EVIDENCE_DIR` to a private directory outside the checkout. Native tests use a fresh profile and mock Keychain, never the installed owner's profile.
