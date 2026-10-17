# Hub overhaul — review build

Based on `81cc63247c070d737bf0bb63b3553f2aef9b6129`, including the remember-device release after PR #5. Development is in a separate clone/branch; production checkout, database, credentials and services were not modified.

## Implemented

- Viewport-bounded chat and pinned composer, initial latest position, new-message indicator without moving readers; responsive Arabic/RTL and keyboard tabs.
- Collapsible task rail, real status filters, compact density, updated timestamps, expandable technical records and result summaries.
- Separate per-project/per-agent private message table and human API. Private messages never enter group history, polling updates, group search, Telegram mirroring, or mention dispatch. Existing group records and behavior remain compatible.
- General-chat dialog with conservative keyword/project-name suggestions, explicit correctable destination, unknown destination requiring selection, and private default. Group sharing is explicitly labelled.
- Project-scoped search over tasks/notes, stored files, registered sessions and the selected conversation. Older message matches have a scoped item route. Results capped at 100; Arabic matching supported.
- Decisions view reads actual pending approvals, human-assigned tasks and blocked tasks. Existing atomic approval execution is reused; no synthetic approvals.
- Nested project relationships with cycle prevention and Work/Uni “My projects” navigation.
- Session registry and structured task results, with same-project task/file/session validation. File previews render as text. Original session URLs are explicitly registered, allowlisted and never generated from task IDs.

## Deliberate integration gaps — do not call these complete

Private messages default to **storage only**. An explicit checkbox can request a private text reply when the existing API-mode provider is configured. The API path supplies only that project/agent DM history, bypasses team context, memories, activity, routing and notifications, and never falls back to another provider. Status persists as working/completed/failed/interrupted. Mocked Anthropic end-to-end proof passes; no live API calls were made. Subscription-mode CLI adapters remain unavailable for private replies because their isolation/fallback contract has not been established. No native Claude/Codex session is created or awakened. Enabling new credentials or a paid API mode is a separate approval, not part of this implementation. The existing shared MCP credential does not provide a strong per-agent identity boundary; adding connector DM reads needs a separate identity design.

Native application chats are not automatically imported. The sessions view lists explicitly registered Bridge sessions only. Its registration API requires source/title/id; optional URLs are checked for supported syntax, not remotely proven by the server. The local preview contains the actual verified current Codex task URL and labels its status as a snapshot. No fabricated percentages or implied live presence.

Structured deliverables, source sessions, and parent projects have persistence APIs; older task records do not acquire invented file/session relationships. The initial production registry will be empty until known records are registered. Missing links/results are shown as unavailable. New projects can select an existing workspace in the creation dialog. Sessions and task result cards have bilingual metadata editors. Known current Codex and Claude release source references can be selected explicitly in the default project; task association is never guessed. User-entered links are syntax validated, not claimed remotely verified. Reparenting existing projects remains API-only.

General classification is a conservative local heuristic, not an AI classifier. It asks for selection on uncertainty and permits correction. Requests to group chat retain existing mention-trigger behavior and approval policy.

## Preview and validation

`node scripts/preview-hub.mjs` starts http://127.0.0.1:4317/#project=default using `.preview/review.db`. It binds loopback, starts no scheduler/Telegram, inherits no application credentials, and blocks external-action mutations. Group messages in preview are stored without dispatch. The seed is clearly labelled demonstration data. Do not use this mode for production.

- `npm test`: 31 passed, including cookie authentication, regression coverage, private isolation, no mirror/dispatch, invalid scopes, session URL validation, same-project results and parent cycles.
- `node test/hub-ui.mjs`: 38 browser checks passed, including warm-cache recovery, RTL/mobile geometry, composer bounds after notices, escaping, dedup/reconnect, private navigation, new-message scroll preservation, task filters and search.
- Native Chrome inspection on the Mac performed against the loopback preview. Test screenshots contain fixtures only.
- Content hashes updated; no dependencies or framework migration.

## Design references and licensing

Separate review design: https://www.figma.com/design/GUyxttaB4nhl8BElW81fl2 (desktop 1:2, mobile 1:26). Existing study file `Ak5doJUqcOB4qSC8KNb7JO` was read only; its Communication frame informed the dark surface, bubbles and fixed header/scroll regions. Existing local avatar assets are reused. No new Figma assets were exported into code; export requires the requested separate approval.

https://github.com/LitenApe/Kitchen is an abandoned alpha React 17/Framer Motion 4/CRA 4 sandbox, with no license file or package license established from the inspected root/package metadata. No source copied or dependencies adopted.

https://www.dqnamo.com/kitchen provides interface experiments (tactile buttons, scroll fades, dynamic buttons). No reuse license established. Used as interaction inspiration only; no code/assets copied. Motion remains restrained and respects reduced-motion preferences.

## Review before rollout

Do not merge or deploy this draft before Shahed reviews scope and the integration gaps. Production migrations are additive tables only. Back up the live database through the normal deployment process before any eventual approved rollout. Recheck upstream head and rerun tests if incoming changes alter auth, routing or chat behavior.

## Follow-up acceptance checklist

- [x] Session create/edit UI: source allowlist, optional actual link, explicit unknown status, same-project task selection, safe missing-link state.
- [x] Result create/edit UI: summary, actual stored file selection/preview and registered source session; never changes task completion automatically.
- [x] Confirmed Codex task and Claude release reference choices, without silently associating a task or importing app histories.
- [x] Optional API private reply path and persisted request status, default off; no shared-context/memory absorption or CLI fallback.
- [x] Mock provider end-to-end reply isolation; no live provider traffic or costs.
- [ ] Subscription/native-agent private reply adapter and native session creation: no verified isolation contract is available. API-mode replies are not native application conversations.
- [ ] Automatic discovery of every native application session: no supported Bridge integration available; explicit registration remains required.
- [ ] Figma exports: awaiting the separately required approval; existing assets continue to work.
- [ ] Merge/deploy: awaiting scope review; draft remains unmerged.
