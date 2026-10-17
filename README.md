# VG-hoster
bot 24/7

## shopping-list skill

- `shopping-list/` — Claude skill (SKILL.md, scripts, list template, tests). Packaged: `packages/shopping-list.skill`
- `chatgpt/` — Custom GPT pack (instructions, template, SETUP.md). Packaged: `packages/shopping-list-chatgpt.zip`

### Run the two live tests on your laptop (needs your Amazon sign-in and your `gh` login)
```bash
cd shopping-list
pip install playwright && python3 -m playwright install chromium
python3 tests/run_all.py                                   # all offline tests

# Amazon (a browser opens; you sign in yourself, once)
python3 scripts/amazon_list.py login
python3 scripts/amazon_list.py create "Iced Matcha Latte" examples/iced-matcha-latte.json \
        --update-list examples/iced-matcha-latte.json --out amazon-report.json
#  -> report shows added / not_added (+ why) and share_url only after the signed-out check passed

# GitHub Pages (uses `gh auth login`; creates public repo cartflow-lists)
python3 scripts/publish_pages.py examples/iced-matcha-latte.json --browser-check
python3 scripts/publish_pages.py examples/iced-matcha-latte.json   # again: same URL, no duplicates
```
