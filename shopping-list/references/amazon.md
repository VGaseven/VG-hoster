# Amazon.sa list — details

Runs only where Claude Code can open a visible browser on the user's own computer (not claude.ai, not ChatGPT, not a cloud sandbox).

## Setup (once)
```bash
pip install playwright && python3 -m playwright install chromium
# or use your installed Chrome: add --channel chrome to every command
```

## Flow
1. `python3 scripts/amazon_list.py login` — opens amazon.sa in a visible window using the profile folder `./.amazon-profile`
   (`--profile` to change). The user signs in by hand (password, OTP — all typed by them). The script never fills password/code
   fields (`safe_fill` refuses), and waits up to 15 min, detecting the "Hello, <name>" header. Ask the user to tell you when done.
2. `python3 scripts/amazon_list.py create "<list name>" list.json --update-list list.json --out amazon-report.json`
   - Search `amazon.sa/s?k=…` (English UI via `language=en_AE`), drop results whose title lacks the item's core words
     (a "milk jug" never stands in for a "milk frother") or already shows a wrong size/variant, prefer non-sponsored.
   - Open up to 4 candidate product pages, read title, brand, size (title or product details), price, availability,
     and accept only `exact` / `equivalent` matches (see matching.md). Otherwise the item goes to `not_added` with the reason.
   - Create the list (named after the topic) if it doesn't exist; add each match via **Add to List ▾ → <list>**; re-read the
     list page and confirm each ASIN is on it.
   - **Send list to others → View only → Copy link.**
   - Open that link in a brand-new browser (no cookies, not signed in) and confirm every added ASIN shows.
     Only then is `share_url` set and `verified_signed_out: true`.
   - `--update-list` writes the exact `amazonUrl`s, Amazon prices and `amazonListUrl` back into list.json, so the HTML/Pages
     list shows the same products.
3. `--dry-run` searches and matches only (no list changes) — useful to preview what would be added.

## Report (stdout and --out)
```json
{"list_name": "Iced Matcha Latte",
 "added": [{"name": "...", "asin": "B0...", "url": "https://www.amazon.sa/dp/B0...", "title": "...", "price": "125.00", "match": "exact", "notes": []}],
 "not_added": [{"name": "Sary Squeeze Honey", "reason": "no listing with the right brand/size/variant in the results"}],
 "share_url": "https://www.amazon.sa/hz/wishlist/ls/XXXX?ref_=wl_share", "verified_signed_out": true}
```
Exit code 0 only with a verified share URL.

## Safety (enforced in code, covered by tests/test_amazon_offline.py)
- `safe_click` refuses any element whose id/name/label/text says Add to Cart, Buy Now, Checkout, Place order, 1-Click,
  or the Arabic equivalents.
- Every browser context blocks purchase URLs (`/gp/buy/`, `/checkout`, `/cart/add…`, `/gp/add-to-cart`, `/gp/aws/cart`, …).
- `safe_fill` refuses password / OTP / card fields. Nothing about the login is read or stored by the script; the session
  lives only in the profile folder, which is in `.gitignore`.

## When Amazon's page differs
Amazon changes its layout. If the script can't find a control it shows a green banner in the browser ("please click
Add to List ▾ and choose …", "please click Send list to others → View only → Copy link") and continues once the user
does it — it still verifies the result itself. If Amazon shows a robot check, the user solves it in the window.
Quantities are not set on Amazon lists; the HTML/Pages list carries them.
