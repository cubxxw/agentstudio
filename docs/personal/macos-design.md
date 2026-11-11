# macOS visual direction

AgentStudio is a conversation workspace. Comfortable reading, clear navigation and
recoverable work take priority over decorative surfaces. These references inform
our own layout, tokens and interactions; no reference app's code or assets are used.

## Reference order

| Order | Reference | Pattern used in AgentStudio |
| --- | --- | --- |
| 1 | [Things 3](https://culturedcode.com/things/support/articles/3238254/) | Restrained hierarchy, quiet selection, collapsible list for focused reading |
| 2 | [Pixelmator Pro](https://support.apple.com/guide/pixelmator-pro/welcome/mac) | Content leads; compact tools stay at the edges; reading width remains bounded |
| 3 | [Craft](https://www.craft.do/zh-CN/blog/craft-update-3-3-7) | Comfortable typography, consistent result cards and reader surfaces |
| 4 | [CleanShot X](https://cleanshot.com/features) | Compact contextual message actions, immediate press feedback |
| 5 | [IINA](https://iina.io/) | Mac materials, system appearance, keyboard access and quiet controls |
| 6 | [Cider](https://cider.sh/) | Cohesive surface, accent and shape tokens across light and dark appearance |

The mapping is a design judgment, rather than a claim that each app implements
every specific treatment above. Things documents its collapsible sidebar; the
other references provide visual and interaction context.

## Implementation

1. Neutral rail and sidebar, system typography, segmented filters, elevated but
   quiet selected rows. Blue marks actions; amber marks pending decisions.
2. A persistent list toggle (`⌘\`, or `Ctrl+\`) keeps the current conversation
   and draft mounted. `⌘K` and rail navigation restore the list. The toggle is
   ignored under 761 CSS pixels and while a dialog owns keyboard input.
3. Keep conversation and composer padding aligned around an 800 px reading area;
   use 15 px body type with 1.8 line height and a 17 px artifact reader.
4. Frame the existing reply/copy controls as one small contextual tool strip.
   Hover and keyboard focus reveal it; touch keeps it available. Buttons respond
   on press, without adding idle motion or blocking input during transitions.
5. The personal macOS window uses Electron's
   [sidebar vibrancy and followWindow state](https://www.electronjs.org/docs/latest/api/browser-window).
   Only navigation reveals the material. Text content stays opaque. CSS offers
   solid navigation under reduced transparency and stronger contrast when asked.
6. Shared semantic tokens cover both appearances, dialogs, input fields and
   pending states. The retained Matrix renderer keeps its own design system.

## Validation

`node dev/macos-design-acceptance.mjs` checks browser navigation, draft continuity,
reload, keyboard focus, dialogs, light/dark appearance, accessibility preferences
and the narrow Back flow. `--native` exercises the built Electron entry and its
isolated profile. Evidence is explicitly synthetic: local organization only,
with no private history, provider call or fabricated user record.

The existing messenger acceptance remains the regression check for agent identity,
private/group conversations, approvals and artifacts. OS material fidelity still
requires visual inspection of a native window; a browser screenshot cannot prove it.

### 2026-11-11 local evidence

Personal and desktop builds and type checks pass. Desktop unit tests: 115/115;
personal unit tests: 84/84. The design journey passes seven browser checks and six
actual Electron checks, with no renderer exceptions. The existing messenger
journey passes 15 browser and 15 Electron checks. Native light/dark screenshots
were captured with macOS window capture, without a renderer fallback.

Review found insufficient contrast on the amber count badge; it now uses dark
digits. A real touch-capable browser context exposed message tools covering the
timestamp; those tools now occupy their own row, with geometry assertions for
both incoming and outgoing messages. An early test incorrectly expected alpha
from Electron's `getBackgroundColor()`; Electron documents that it returns RGB
only. That assertion was removed and native window captures were added. Final
evidence lives in registered artifact `ai-test-agentstudio-macos-design.N9GoA8`.

These checks use isolated, explicitly synthetic records and deterministic local
organization. They do not establish private-provider acceptance, VoiceOver,
physical input-device testing, notarization or distribution.
