# Roomie anime portrait

Tracking: [GET-529](https://linear.app/getyak/issue/GET-529/give-roomie-an-expressive-anime-character-avatar).

The user requested an anime character portrait with more personality. This original adult character uses expressive eyes, tousled green hair and a crooked smile. The existing application icon was supplied only as a palette/personality reference. The result is bundled locally and remains stable across model/backend changes.

- Tool: built-in `image_gen.imagegen`, 2026-11-13.
- Final asset: [roomie-anime-v1.png](../../../packages/brand/assets/roomie-anime-v1.png).
- Original output: `exec-03c819ed-8e37-415a-9770-dc4f292d0041.png`; copied without pixel edits.
- Background: opaque pale sage/cream, suitable for rounded-square or circular avatar masks.

## Exact prompt

```text
Use case: stylized-concept. Asset type: square anime character portrait for a friendly AI workspace steward's chat avatar. Image 1 is ONLY a reference for the current product's forest-green and warm cream palette and playful personality, not an edit target to preserve. Create a NEW ORIGINAL HUMAN anime character, a clearly adult and slightly androgynous young adult companion, shoulders-up close portrait. Expressive amber-green eyes, short tousled dark forest-green hair, warm lightly freckled face, a subtle crooked smile with one small canine visible, one eyebrow lifted, head tilted slightly, looking toward the viewer as though a clever idea just occurred. A simple forest-green hoodie with cream lining; relaxed and approachable. Beautiful hand-drawn Japanese anime illustration, crisp organic ink outlines, thoughtful cel shading, soft warm highlights, appealing character acting, lively asymmetry; less chibi and more a personable modern slice-of-life anime adult. Large face occupying most of the square so expression remains legible at 32 pixels, shoulders cropped at bottom, enough margin for rounded-square and circle masks. Plain pale sage/cream background. No lettering, logos, text, watermark, props or extra characters. No 3D clay, no monster body, no robot, no flat corporate pictogram, no stiff symmetrical passport pose. Deliver one finished avatar image.
```

Reference image: `apps/desktop/resources/icon.png`. `transparent_background: false`.
