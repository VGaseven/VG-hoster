# Approved actions, 17 October 2026

Approval relayed at 12:30 UTC: one exact Claude subscription prompt `Reply with OK`, read-only Codex names/IDs limited to `/Users/shahed/VG-hoster`, and exports from the separate Figma design.

## Claude smoke test

One logical request was submitted through `sendDirect` in a fresh isolated database. The default-off flag was enabled only in that process, with API credentials/endpoints absent and a Claude-only no-fallback adapter. A durable exclusive marker prevents accidental re-execution. Result: **failed, no reply**. The human test message is the only DM record. Group messages/search matches, activity delta and memory delta are all zero (see approved-smoke-result.json).

The adapter intentionally suppresses raw CLI errors; consequently this run did not retain evidence distinguishing authentication, option compatibility or provider failure. Provider receipt and subscription billing mode are **not verified**. No retry or second live message was sent, no credential was opened, and no production flag was enabled. A further live diagnostic attempt would require renewed approval; do not call the live integration successful.

## Codex discovery

Supported `app-server daemon version` reports a running daemon 0.163.0-alpha.10.2 and CLI 0.163.0. Proxy initialization using the CLI's default socket and then the exact returned socket each timed out with zero response bytes. Only `initialize` was sent; the code sends its scoped `thread/list` request only after a successful initialization. Listing parameters are exact cwd `/Users/shahed/VG-hoster`, `useStateDbOnly:true`, explicit source kinds and pagination. Any returned row with a different cwd would stop the operation. Only ID and name are retained; no preview, message or transcript data is written.

A final version-matched proxy attempt uses the daemon executable path returned by its supported version command. Its result is appended below. No service is started/restarted, no access configured and no private session files read.

## Figma export and integration

Approved file: https://www.figma.com/design/GUyxttaB4nhl8BElW81fl2 . Downloaded desktop node 1:2 (1120×800) and mobile node 1:26 (390×844) into `evidence/figma-approved/`. Both exports reported zero raw images and zero SVG assets. The design consists of editable text and layout primitives, so there are no independent icon/image assets to transplant.

Node 1:6's high-fidelity design context was translated into scoped native CSS tokens: surface, composer, input, task rail, human/agent bubble colors, accent colors and 14px bubble radius. Interactive DOM controls remain interactive. The exported PNGs are review references, never raster replacements for UI. Existing agent avatars are retained. No temporary download URL is embedded in runtime code; the original study file was not edited.

Final version-matched Codex proxy result: **blocked — initialization timed out after 10 seconds with zero response bytes**. No scoped list could be sent and no names/IDs were retrieved. This is a transport-handshake blocker, not proof of missing sessions or an authentication failure. Further work needs protocol/daemon diagnostics; no daemon restart or access change was attempted.
