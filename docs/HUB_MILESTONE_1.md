# Hub milestone 1

The hub is served at `/`. The original dashboard remains at `/classic` (also
`/classic.html`). All project, chat and file operations use existing `/api/*`
routes and the existing Bridge token check; MCP, Telegram and webhooks are unchanged.

Included: English/Arabic with RTL and a remembered language preference, responsive
project cards and search, project creation, project-scoped chat with five-second
refresh, and versioned file listing with inert text preview and download. HTML
files are displayed as text, never embedded or executed. No map, timeline, study,
portfolio, idea inbox or new MCP tools are included in this milestone.

## Authentication

The hub intentionally keeps an entered token only in JavaScript memory for the
open page. It sends it in an Authorization header, never in a URL or cookie.
Reloading or locking the hub clears its access. The hub ignores existing cookies;
it neither reads nor changes the classic dashboard's existing authentication
storage. The token is never shown after submission. Only the language preference
is saved in localStorage. This is the approved deviation from the brief's
remembered-login/show-token suggestions; no persistent credential feature was added.

The classic dashboard retains its existing behavior. As before, a server started
without BRIDGE_TOKEN is unauthenticated; this change does not alter server policy.
Google Fonts is optional: the interface remains usable with local fallback fonts.

## Validation and preview

- `npm test`: integration tests use temporary databases and mock integrations.
- `node test/hub-ui.mjs`: headless Chrome with an isolated temporary profile and
  fake API data. Set `CHROME_BIN` if Chrome is elsewhere. It verifies login,
  language/RTL, 320px overflow, search, project isolation, creation, safe file
  previews, chat submission and absence of credential storage.
- Set `HUB_SCREENSHOT=/absolute/path/home.png` on the UI test for a desktop fixture
  screenshot. This screenshot contains only fake data.

For an isolated manual preview, start the server with a fresh DB_FILE, an unused
PORT and a disposable BRIDGE_TOKEN. Do not load the live `.env` for a preview.
The PR itself does not deploy or restart the production Bridge.
