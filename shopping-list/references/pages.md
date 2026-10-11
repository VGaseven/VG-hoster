# GitHub Pages list — details

`python3 scripts/publish_pages.py list.json [--add] [--browser-check] [--owner ORG] [--repo cartflow-lists]`

1. `gh api user` → owner. Creates `<owner>/cartflow-lists` (public, with README) if missing.
2. Clones/updates it in `~/.cache/shopping-list/repos/` (outside your project, never committed with it).
3. Writes `l/<id>/index.html` (built from `assets/list-template.html`), `.nojekyll`, and a blank root `index.html` (no directory of lists).
   - `<id>`: `pagesId` in list.json → local index by title → new random 12-char id.
   - Items are de-duplicated by brand + name words + size + pack. `--add` merges with the live list.
4. Commits, pushes, turns Pages on (branch root) if needed, waits for the Pages build of that commit.
5. Downloads `https://<owner>.github.io/cartflow-lists/l/<id>/` with no cookies and checks: HTTP 200, every item present once,
   right title. `--browser-check` also opens it in a fresh Playwright browser and counts items.
6. Prints `{"url": ..., "verified_signed_out": true, ...}` and saves `pagesId` / `pagesUrl` into list.json.

Privacy: the repo is public — anyone can browse every list in it. The script prints this warning once
(`~/.cache/shopping-list/warned-public`). Ask before publishing lists with personal details.

Errors: `gh` missing / not logged in → `gh auth login`. Pages build errored or took >10 min → message names the last status;
re-run (same URL). First-ever Pages deploy can take a few minutes.
