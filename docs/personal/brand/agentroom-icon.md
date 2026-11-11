# AgentRoom icon: the forest roommate

Tracking: [GET-500](https://linear.app/getyak/issue/GET-500/give-agentroom-a-mischievous-room-mascot-icon).

![AgentRoom's forest-green doorway creature](../../../apps/desktop/resources/icon.png)

The new icon gives **Room** a character: a forest-green arch with two uneven eyes and one crooked tooth. The doorway is also the creature's mouth and body. Its sideways glance adds a slightly mischievous, ugly-cute personality.

The design takes the user's broad reference to Labubu's charismatic ugliness as an emotional direction. The room silhouette, facial arrangement and single tooth are an original design rather than an existing character's costume, long ears or tooth row.

Three visual directions were explored: a warm terracotta house, the green arch creature, and a black/orange graphic house. The green arch was recommended for its stronger character and less literal room shape. After the user authorized proceeding with the recommendation and opening a remote PR, this direction was finished for the repository. No installed application was replaced as part of this PR.

## Source and exports

- Unmodified high-resolution imagegen master: [agentroom-roommate.png](../../../packages/brand/source/agentroom-roommate.png).
- [Exact generation prompts](agentroom-icon-prompts.md), including the final edit that preserves the selected character.
- Reproduce the production files on macOS from the repository root:

```sh
swift dev/export-brand-icons.swift
```

The exporter crops just inside the source tile at `(100, 94, 1056, 1056)` in AppKit's lower-left coordinate system. Desktop exports use an 824 px tile inside a 1024 px transparent canvas, with a clean rounded-rectangle mask to remove the generator's stray perimeter pixels. The source art is unchanged.

| Consumer | Asset |
| --- | --- |
| Desktop window/Dock and README | `apps/desktop/resources/icon.png` — 1024 px with transparent native padding |
| Packaged macOS bundle | `apps/desktop/resources/icon.icns` — all standard 16–1024 px representations |
| In-app brand/sign-in image | `packages/brand/assets/agentstudio.png` — opaque 1024 px |
| Expo app icon | `apps/mobile/assets/icon.png` — opaque 1024 px |
| Expo web favicon | `apps/mobile/assets/favicon.png` — 48 px with transparent padding |

Package names, application identifiers, storage and provider logos remain compatible. No color theme or runtime behavior changes are included.

## Verification — 2026-11-11

- Exporter completed on macOS; `iconutil` successfully decoded the final ICNS back into all ten standard representations.
- All 14 exported PNG representations were decoded and checked for expected dimensions and alpha format. Native transparent margins contained no stray pixels; shared/mobile 1024 px exports are opaque and identical.
- A second export reproduced all five production files byte for byte from the preserved source.
- The 16 px and 32 px ICNS representations were visually inspected. Packaged-app launch, installed Dock/Finder appearance and real-device mobile acceptance are not claimed by these asset checks.
