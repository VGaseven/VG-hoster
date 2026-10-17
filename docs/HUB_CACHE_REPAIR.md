# Mixed release cache repair

The affected Chrome tab was directly inspected on 2026-10-17. It rendered the new HTML with old JavaScript: `copy.en.conversation` was absent, `renderMessages` contained no avatar code, and both unversioned assets had zero transferred bytes in Resource Timing (cache). No service worker controlled the tab. Public asset responses advertised `Cache-Control: public, max-age=14400`.

`index.html` now references CSS and JS with a SHA-256 content version in their URLs. This gives a changed asset a new browser/CDN cache key. Run `node scripts/version-hub-assets.mjs` after editing either asset. A test prevents shipping HTML with stale/unversioned references.

The browser regression test first loads the pre-release JS/CSS with a four-hour cache lifetime and reproduces literal translation keys and missing avatars. It then navigates normally to the repaired HTML in the same browser profile and verifies translated labels, avatar geometry, bubble styling, project isolation, keyboard/RTL, and polling/reconnection. No hard refresh or cache clearing is used.

No API, message data, authentication storage, agent routing, or service configuration changes. A normal reload clears the existing memory-only Hub login; the user re-enters their token directly in the browser. Verification of public file bytes alone is insufficient to establish that an already-open client has loaded the release.
