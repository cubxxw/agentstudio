# Live conversations and agent profiles

GET-485. One Messenger remains the only personal interface. The user asks for working continuous questions, graceful response feedback, live CLI configuration, editable contacts, distinct avatars and better reading. Proceed autonomously under the project agreement.

## Behavior

Keep the durable per-agent follow-up queue. Sending stays available while an earlier answer is being generated. Each accepted question owns its response slot, with accurate preparing/thinking/writing/queued/failed/stopped states and a precise stop control. Render real text updates only; do not simulate typing tokens or expose raw thinking. Partial text is recoverable progress, never a completed artifact. Completion requires successful authoritative output and process exit.

Fix causal context: M1, then M2 sent during M1 must yield context M1/A1/M2 for run2, excluding future M3. Late replies are associated with their originating run. Keep participant, recipient and post-join boundaries.

Contacts have an identity, local backend, model policy (follow local startup defaults or fixed provider/model), independently inherited/fixed thinking, and avatar symbol/color. Show detected defaults when creating/editing, with explicit refresh. Read only approved configuration fields; no credentials, remote headers or source configuration files reach the renderer. Do not overwrite identity edits during discovery. Pi terminal session selection differs from saved startup defaults; explain that distinction in the UI and let the contact choose its own model.

Resolve actual provider/model/thinking when a message is accepted; persist an immutable execution snapshot. Queueing, later configuration changes and retry do not change it. Pi uses an ephemeral JSON process with tools/extensions/context discovery disabled, explicit provider/model/thinking, its existing authentication and no automatic provider fallback. Invalid model/credentials/quota are separate, accurate failures. Other CLIs expose only supported options; settings must reach their actual execution flags.

## Visual direction

Observed Grok Bot 0.79.3 on this Mac: compact list, distinct colored avatars, neutral rounded bubbles, restrained chrome and a continuous composer. Installed design assets contain separate typing/queued-send/transcript states and entry motion. Asset observations are implementation inference; no synthetic send was made in the user's existing Grok conversations. No proprietary implementation or private transcript is copied into the repository.

Keep Telegram-like navigation and blue actions, soften bubbles to gray/blue, increase body to 15px with 1.65 line-height and a readable maximum width. System font throughout, quiet timestamps, 18px message corners, 8px spacing between short grouped messages. Markdown headings, lists, quotes, code language/copy and locally scrolling tables share that hierarchy. Typing dots belong to the responding contact, stop controls remain separate from send. Reduced motion uses a static status.

## Verification

Test model refresh/follow/fixed snapshots and no fallback; Pi JSON failure with exit 0; split UTF-8, partial output then failure/cancel, exact final replacement, queue/cause boundaries and no future/member leakage. Browser and actual Electron exercise a delayed first reply plus two follow-ups, configuration editing/reload, icon selection and Markdown in narrow/dark views. Real CLI acceptance uses synthetic input and existing provider only. Install after review and CI; retain personal data and rollback bundle.
