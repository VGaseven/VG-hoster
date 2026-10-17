# Native integration assessment — 17 October 2026

Bounded inspection only: local source, CLI `--help`/`--version`, and locally generated public protocol schemas. No private session files, credentials, live agent prompts, account/daemon queries, or persistent access changes. Installed versions: Claude Code 2.1.301; Codex CLI 0.163.0. The Codex help command reported inability to create PATH aliases in the sandbox; help and schema generation still completed.

## Exact existing routing problem

`core.askAgent` logs the prompt unconditionally, even with `feed:false`, and calls `absorb` on the result. `llm.ask` normally supplies shared team context. `cli.askViaCli` switches providers on plan limits. None is an appropriate DM entry point. The new DM path bypasses these: selected DM history → exact private adapter → `direct_messages` with the original project/agent, with request status in `direct_requests`. Errors become `failed`, never shared raw error text.

## Implemented, disabled by default

`HUB_PRIVATE_CLAUDE_CLI=1`, only in subscription mode, offers experimental Claude text replies. This flag was **not set in any persistent configuration or running preview/production process**. The existing Claude installation/authentication is reused only if a future operator enables it and the user requests a reply.

The adapter checks CLI help for required flags before sending a prompt and fails closed if absent. It uses `--safe-mode --restricted --no-session-persistence --strict-mcp-config --disable-slash-commands --no-chrome --tools ""`, a replacement system prompt, and a disposable empty working directory. The child receives a minimal OS environment, not Bridge tokens, API keys, custom provider endpoints, or other application secrets. No resume, cloud, desktop, session persistence, shared context, tools, or provider fallback is invoked. Older CLIs are rejected. The current provider's normal authentication and organization-managed policy still apply; this is not an OS security boundary against that provider or the local user.

Why not `--bare`: installed help explicitly states bare mode excludes OAuth/Keychain and requires API authentication. Safe mode retains normal authentication while disabling user customizations, hooks, skills, auto-loaded instructions and installed plugins. Built-in tools are independently disabled. No billing/authentication claim has been verified by a live invocation.

Mock HTTP end-to-end coverage exercises the real server, DM worker and subprocess adapter with a fake executable: exact flags, empty tools, minimal environment, no other DM/shared memory in input, result scoped to Claude DM, no group/search/activity/memory leakage, safe failure, no Codex fallback, temporary-directory cleanup. A separate test proves the default-off guard prevents launching a CLI. No real subscription allowance was consumed.

Smallest next decision for this adapter: after scope review, authorize **one non-sensitive Claude subscription smoke test** with the flag set only for that test process. Confirm account/billing mode in the user's normal UI first; no credentials need to be supplied to Bridge. Until then, this is mock-verified experimental support, not verified live replies.

## Codex private replies: precise remaining blocker

The current `runCodex` uses `exec --ephemeral --ignore-user-config --sandbox read-only`. Read-only constrains writes, not access to unrelated readable files; it does not disable shell/file tools. Its inspected help has no equivalent to Claude's empty `--tools` whitelist. `--ignore-user-config` explicitly retains authentication via CODEX_HOME and does not promise removal of all other instruction/plugin sources. No complete no-tool/no-extra-context contract was established from the generated stable thread/turn schemas either. We therefore do not enable this adapter for DMs, and do not guess undocumented config flags. A reviewed OS read sandbox or documented no-tool transport is needed before a live Codex DM trial. Merely approving a test would not resolve that technical boundary.

## Supported session interfaces found (not invoked)

| Interface | Actual support shown locally | Remaining work / smallest decision |
| --- | --- | --- |
| Codex app-server | `thread/list`, `thread/start`, `turn/start` in generated schema; list supports exact cwd filters, pagination, sourceKinds, and `useStateDbOnly:true` | Bridge has no client, project-to-cwd allowlist, daemon ownership contract, or approval/event broker. A thread/start ID is not itself proof of Desktop visibility. Approve read-only discovery for one explicitly selected project cwd before querying the existing daemon; use state DB-only listing to avoid rollout repair/scans. Do not start turns during that check. |
| Codex CLI | `agents` browses sessions on shared daemon; `exec --json` emits events; omitting ephemeral permits persistence | Do not infer app visibility from persistence or synthesize links from a task id. Validate an actual returned thread id in Desktop before recording it. Current DM adapter intentionally creates no native session. |
| Codex Cloud | `cloud list --json --env …`, `cloud status`, `cloud exec --env …` | Existing `runCodexCloud` creates tasks but routes through shared chat, parses a loose URL, and has no DM completion callback. Requires explicit chosen environment and approved cloud task; no account configuration was read. |
| Claude Code | `agents --json --all --cwd …` offers active/background-session discovery; `--desktop`, `--cloud`, `--background`, `--resume`, `--session-id` exist | This is not a documented list of every Claude.ai chat. Approve a read-only list limited to a selected cwd first; verify returned schema/IDs without reading transcript files. Creating a cloud/desktop session is a separate action and needs a verified completion route before it can serve a DM. |

These are concrete supported entry points, not a claim that no native integration exists. Bridge has not yet connected them. App-level tools available to this assistant are not an installed transport that the standalone Bridge server can automatically call. No native sessions or links were fabricated.

## Kitchen evidence and actual reuse

- [LitenApe/Kitchen](https://github.com/LitenApe/Kitchen), default `old_main`: README calls it an abandoned alpha development sandbox. [package.json](https://github.com/LitenApe/Kitchen/blob/old_main/package.json) declares private package 0.1.1, React 17.0.2, Framer Motion 4.1.17, CRA 4.0.3 and TypeScript 4.7.4. No license file was visible in the repository root and no package license field was present. This does not establish permission to copy its implementation. Hub is vanilla JS/CSS; adoption would introduce an unnecessary React/CRA/Motion migration. **Zero components, code or dependencies copied.**
- [dqnamo Kitchen](https://www.dqnamo.com/kitchen): inspected named studies include Tactile Button, Dynamic Button, Scroll Fade List and Hold to Confirm. No reuse license was established. **Zero components, code or assets copied.**
- Actual Hub implementation uses independently written native buttons, `<dialog>`, `<details>`, CSS overflow/viewport sizing, state labels and reduced-motion handling. Compact controls and readable overflow were general design references. It does **not** implement Kitchen's compressible tactile face, animated width morph, scroll-fade mask or hold-to-confirm interaction. Existing 150ms project-card hover motion predates this overhaul. Thus “Kitchen-inspired” must not be presented as component reuse or as new bespoke animation work.
- The separate Figma file remains the visual review deliverable. No Figma export was performed; approval remains pending.
