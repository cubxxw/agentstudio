# AgentRoom visual language

AgentRoom is a room for conversations with distinct people and agents. macOS Messages is a reference for comfortable navigation, text size and native window behavior. AgentRoom's identity comes from the portraits and the way long Agent replies read.

The sidebar stays quiet, the selected conversation becomes a white inset surface, and provider portraits carry their original colors. Agent portraits use a rounded square; people remain circular. The contact header belongs to the toolbar instead of reproducing Messages' centered avatar stack.

Agent replies sit directly on the reading surface. They have no repeated identity, timestamp, model label, document link or surrounding gray panel. The owner's messages use a deep slate-blue bubble with white text and an even radius. Group portraits align with the beginning of their reply. Failure, incomplete delivery and approvals remain explicit.

| Token | Light | Role |
| --- | --- | --- |
| Reading surface | `#ffffff` | Opaque, uninterrupted reply text |
| Sidebar | `#f3f5f7` | Quiet navigation material |
| Ink | `#27343e` | Main text and identity |
| Secondary ink | `#5d6b77` | Supporting text |
| Action | `#35627b` | Links, selection and focus |
| Owner message | `#294f68` | Separates the owner's input from Agent text |

Use the system SF/PingFang stack. Body text is 15 px with 1.85 line height; restrained headings and paragraph space support longer Markdown replies. Portrait shape scales with size. Avoid gradients, ornamental dividers and repeated labels. Empty states use one plain symbol and useful next actions.

Dark mode uses blue-gray surfaces with light ink, retaining the same reading hierarchy. Keyboard focus, narrow navigation, reduced motion, increased contrast and persistent test-mode identification remain part of the design.
