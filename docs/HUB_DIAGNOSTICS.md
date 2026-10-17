# Safe diagnosis after approved smoke checks

No second live Claude invocation, session creation, reauthentication, daemon restart, production flag or access change occurred in this diagnosis.

## Claude evidence and improved handling

The one approved attempt's retained artifacts are its isolated SQLite DB, single-attempt marker, script and result JSON. The CLI helper held stdout/stderr only in memory; the old private adapter replaced unsuccessful results with a generic error, and the DM worker persisted only `failed`. There is no captured raw stderr/error file to recover. The original root cause is **unknown and unrecoverable from the retained evidence**. We did not inspect Claude's private logs, session files or credentials.

Future failures now retain two allowlisted fields in the originating DM request only: category and stage. Categories: auth_required, permission_denied, rate_limited, timeout, unavailable, unsupported_cli, network_error, invalid_response, provider_error. Stages: preflight, invoke, provider. Numeric statuses, recognized OS error codes and limited CLI text patterns select a category; unmatched failures stay generic. A category is diagnostic guidance, not proof of an account condition. Raw stdout/stderr, provider error strings, prompts, account names, URLs, tokens and stack traces are never persisted or exposed by this path. UI guidance is bilingual. Existing request rows remain valid with null diagnostic fields.

Mock coverage includes all categories, malicious/secret-bearing strings, a fake CLI authentication failure through HTTP → DM worker → subprocess, no leakage to group/search/activity/memory, disabled controls and translated UI guidance. No automatic retry was added.

## Codex: concrete client protocol error

The earlier probe incorrectly treated `codex app-server proxy` as a newline-JSON endpoint. Local help calls it a byte proxy, and the OpenAI maintainer's explanation specifies that the control socket expects an HTTP WebSocket Upgrade followed by WebSocket frames:
https://github.com/openai/codex/issues/23572
Implementation references named there: `codex-rs/stdio-to-uds/src/lib.rs` copies bytes; the server accepts a WebSocket handshake. This is a definite framing error in our probe, sufficient to explain why no JSON response arrived. The previous zero-byte result does **not** establish missing authentication, missing sessions or a broken daemon. A corrected client has not yet been tried; additional macOS proxy behavior cannot be ruled out.

Already captured supported version metadata reported a running daemon 0.163.0-alpha.10.2, CLI 0.163.0 and its control socket. Both plain-JSON proxy probes used the wrong protocol, so changing executable version could not fix them. A sandboxed process inventory was denied; no escalation or process/service modification was needed for this diagnosis.

Precise next step: use a standards-compliant WebSocket client against the existing approved Unix control socket (or tunnel the WebSocket handshake and masked frames through proxy), validate the upgrade, then send only initialize/initialized. If initialization succeeds, send the already approved `thread/list` with exact cwd `/Users/shahed/VG-hoster`, `useStateDbOnly:true`, explicit source kinds and pagination. Retain only names/IDs, reject any other cwd. Stop at any authentication/permission barrier. Do not send thread/start, turn/start, account requests, transcript reads, or change daemon configuration. That transport correction is the remaining discovery work; no daemon restart is justified by current evidence.

## Release recommendation

The UI/workflow portion is useful as a staged release after Shahed's review: bounded chat, task rail, scoped private storage, search, decisions, correctable destination selection, metadata editors and Figma-derived styling are independently tested. Keep the experimental subscription flag unset and unverified reply integrations disabled. The UI now explicitly states that unavailable private conversations store messages only and do not contact native apps. Session registration remains explicit; do not describe it as automatic native discovery. This recommendation is not authorization to merge/deploy, and the feature set is not a completed native-agent integration.
