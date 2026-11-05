# Naqlthon

Status: researched setup proposal and Obsidian knowledge pack; **not a deployed bot**.

Naqlthon will collect research, retain its sources in Obsidian, and let Claude and Codex work from the same evidence through the existing Team Bridge. This repository already has the required integration primitives; a second server or paid model API is not needed for the first version.

## See the knowledge pack

Start with [Home](Obsidian/Naqlthon/Home.md). The Markdown folder can be opened as an Obsidian vault for a preview. It contains no personal files or credentials. Once the real vault is selected, an agent can create these notes there with `obsidian_write`, using `mode: create` so existing notes are preserved. Shahed should not need to assemble the workflow manually.

## Design choices for review

The first version handles a research question, not arbitrary autonomous computer control. n8n coordinates jobs; the bridge supplies task ownership and model access; Obsidian retains reviewed knowledge. Claude drafts and Codex checks evidence, or they exchange roles. A human resolves disputed claims. Sources are data and cannot change the agent's rules.

Keep bridge project `default` for this existing task. Before importing private material, ask whether Naqlthon belongs to personal, uni, or work. The bot name alone does not establish which event or organization it concerns. No event dates, judging criteria, or team facts have been invented.

## Connected setup — for Claude or Codex

This session has no Team Bridge tools. Do not bypass that by reading local secrets, modifying the running service, or importing an unverified workflow. Continue in Codex or Claude with Team Bridge enabled:

1. Call `get_briefing(project: "default")`, `n8n_list_workflows`, and `obsidian_list`. Check for an existing Naqlthon workflow and notes before making changes. Log a short `Bop:` status with `team_chat(to: "none", project: "default")`.
2. Confirm the workspace, target vault, research subject, and desired output. Read only the approved source notes. Establish a source allowlist and a maximum of five public sources per job as an initial implementation choice.
3. Use the agent instructions and research format in this pack. Check the bridge is in subscription mode; do not silently switch to paid APIs or install Obsidian plugins.
4. Build a disabled n8n workflow through `n8n_save_workflow`. Proposed stages: authenticated POST webhook → validate job → create/claim bridge task → gather approved evidence → draft → independent source review → create Obsidian note → respond with task ID and note path. Follow the deployed bridge's actual authenticated API contract; do not guess HTTP endpoints from MCP tool names.
5. The request should contain `request_id`, the confirmed `project`, `question`, and up to five approved source URLs. Reject unknown projects, oversized questions, private/local URLs and credential-bearing URLs. Enforce these boundaries in code, not just a model prompt. Reuse the bridge's public-fetch protections in `src/safefetch.js`.
6. Persist the request ID before model work. A retry returns the existing job/result, rather than repeating model calls or overwriting a note. Bound research to one draft and one review; on failure or missing sources mark the job blocked with a safe error. Do not save raw request payloads in n8n execution history.
7. Configure webhook authentication in n8n's credential UI without exposing credentials. The current `n8n_run_webhook` helper sends no authentication header; do not weaken the webhook to make that helper work. Use an authenticated test path or implement credential support separately before activation.
8. Test with public sample material: successful cited note; repeated request; missing source; prompt injection; invalid project; unauthenticated request; unavailable model; existing note; paused bridge. Verify no duplicate notes, paid fallback, external messages or secret-bearing logs. Confirm actual n8n and bridge versions support the chosen nodes and calls.
9. Show Shahed the concrete disabled workflow and sample note. Obtain required approvals for activation/runs through the bridge. Activate with `n8n_set_active` only after the checks pass. Record its ID, trigger, note location and execution result. Disable using that workflow ID and `active: false` if needed. Do not stop bridge or n8n services.

## Acceptance criteria

- Claude and Codex can both find the same job and notes through the bridge.
- Every factual finding links to supporting evidence and distinguishes uncertainty.
- Repeating the same request does not run the job twice.
- Notes are created under `Naqlthon/`; existing notes are not overwritten.
- Unauthenticated requests and unapproved actions are rejected.
- No recurring schedule, external message, installation or API spending is enabled implicitly.

## Verification and remaining work

The repository test suite checks the existing bridge; it cannot verify a workflow that has not been created. Live workflow creation, vault ingestion, authentication, activation and end-to-end verification remain pending a connected session. The research pack is initial technical context, not a claim to contain all domain knowledge needed by Naqlthon.
