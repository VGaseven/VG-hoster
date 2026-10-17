# Group chat preview

Design reference: [uni work — Communication](https://www.figma.com/design/Ak5doJUqcOB4qSC8KNb7JO/uni-work?node-id=735-219), on General (868:120). Read-only inspection. Message components 751:256 and 751:266 supply the dark/pale bubbles, 32px avatars, 12px gaps and 16px radii. Header 751:252 supplies the dark header and participant treatment. Original avatars are saved under public/assets. Dynamic authors use those assets only for their corresponding identity; others use initials. The surrounding Hub remains consistent with milestone 1.

The chat uses existing authenticated chat/tasks endpoints. Task badges reflect project-filtered task records, never inferred completion or online presence. Reply-request text reflects the POST response, not delivery/read receipts. There is no typing indicator, reply-to linkage, or app session integration. Existing APIs, auth, ingestion, webhooks and Telegram are unchanged.

Run `node test/chat-preview.mjs` for a loopback-only preview on port 4317 (override PREVIEW_PORT). It creates a fresh temporary SQLite database with clearly labelled fixtures, never reads .env or loads agent integrations. Sample message submission is local only; project creation and files are not implemented in this fixture server. Real project creation/files remain covered by the browser tests and unchanged production API.

Validation: `npm test` (25 tests); `CHAT_SCREENSHOT_DIR=./evidence node test/hub-ui.mjs` (23 browser checks). Checks cover memory-only token handling, HTML escaping, duplicate IDs, project/chat/task isolation, automatic reconnect, keyboard tabs, 320px RTL, file previews and existing flows. Evidence screenshots/logs live under evidence/. Fixture screenshots are not live team activity.

Branch: codex/figma-group-chat-preview; baseline 036a4d024e8e42927904a652ceb7c4f5faa0ec65. Built in an isolated worktree; no live checkout edits, service restarts, merge or deployment.
