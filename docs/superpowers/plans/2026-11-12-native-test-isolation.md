# Native test isolation implementation plan

**Goal:** GET-512: keep native acceptance out of the user's desktop and reject stale builds before launch.

**Approved scope:** The user accepted background testing, explicit test identity, coordinated native automation, safe recovery bundles and build version verification. Preserve normal startup, signing identity and personal data.

**Architecture:** A shared launcher checks embedded build metadata and a host-wide exclusive lock. Main treats automation as a separate presentation policy, with hidden nonfocusable windows by default and an explicit visible option. Browser acceptance remains the first choice.

**Review focus:** Old bundles without support must fail before launch; a wrong expected SHA must fail; failed launches release the lock; ordinary app launches retain focus behavior; hidden tests retain working renderer input and screenshots.

1. [x] Add failing policy and launcher tests; verify failures.
2. [x] Embed build metadata, implement presentation policy and shared launch gate; migrate native acceptance entry points and remove implicit foreground screenshots.
3. [x] Run unit/type checks and a real hidden Electron journey, including stale-build rejection and focus/visibility checks. Independently review the changes.
4. [ ] Link Linear and PR, pass current CI, merge, verify final build and archive test resources. Preserve recovery references outside .app discovery.
