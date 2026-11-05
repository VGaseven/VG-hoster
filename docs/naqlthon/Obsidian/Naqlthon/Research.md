# Research

Research date: 2026-11-05. Scope: technical foundation for Naqlthon. Live integrations and private project context were unavailable in this session.

## Supported technical facts

**Obsidian can hold the knowledge without a plugin.** Its vault consists of Markdown files; Obsidian notices external edits. This supports creating notes through the existing bridge instead of installing an additional connector. Source: [Obsidian data storage](https://obsidian.md/help/data-storage), retrieved 2026-11-05.

**n8n supports human review for selected AI tool calls.** Approval can be attached to tools that need human oversight. This establishes a supported design option, but compatibility and the installed version still need verification. Source: [n8n human review documentation](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md), retrieved 2026-11-05.

## Evidence from this repository

- `src/n8n.js`: workflow discovery, save, activation, execution listing and webhook calls already exist. A saved workflow and a running workflow are separate steps. The webhook runner does not currently supply credential headers.
- `src/obsidian.js`: supports listing, searching, reading and writing Markdown notes. Create mode refuses an existing note; path checks restrict writes to the configured vault.
- `src/mcp.js`: exposes the n8n and Obsidian operations to agents and includes integration readiness in the briefing. Some tools are global rather than project scoped; a project field alone is not an access-control boundary for vault contents.
- `README.md`: documents subscription-backed Claude/Codex access, atomic task claims and bridge pause/approval behavior. Runtime settings were not inspected, so subscription mode is an intended prerequisite, not a verified live fact.

## Proposed approach

Use n8n for orchestration, the existing bridge for model calls and task ownership, and a dedicated `Naqlthon/` note folder for knowledge. Begin with on-demand research. Avoid a vector database, recurring crawler or additional paid model integration until a real retrieval problem demonstrates the need.

## Missing domain evidence

No authoritative Naqlthon brief, source folder, target audience, event URL, dates, judging criteria, team roles or deliverables were provided or found in the repository. Public searching did not establish a reliable match for the intended project. Do not import information from similarly named transport services as if it belongs to Naqlthon.

Before domain research, obtain the official project link or brief and the specific research question. Then record primary sources for the problem, users, existing alternatives, constraints, relevant data and success measures. Personal material requires a confirmed workspace and explicit source scope. The pack is not yet a complete domain knowledge base.
