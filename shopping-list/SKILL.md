---
name: shopping-list
description: Makes a shopping LIST (never a cart) with ONE link anyone can open with no account or login — a real view-only Amazon.sa list, a GitHub Pages list page, or a single HTML file. Picks products for a goal ("matcha latte groceries", "new phone setup") or uses named products, checks real Saudi stores (prices in SAR), matches brand/size/variant, and shows checked prices only. Use for any shopping, groceries, gifts, electronics, beauty, baby, fashion or home request — "make me a shopping list", "one link with everything", "put these on an Amazon list", "send me a list I can share", or after you recommended products and the user agrees.
---

# Shopping list (no login)

The user wants: *"a list, not a cart — one link, no account or login. From the list, I choose what to add to my cart."*

Always:
- **A list, never a cart.** Never add to any cart, never buy, never check out.
- **One link, no login to open it.** Amazon.sa list (view-only) when the user wants Amazon; otherwise GitHub Pages; otherwise the HTML file itself.
- **Real data only.** A price appears only if it was read from that store's product page just now; otherwise `null` → "Price not checked". Links go to the exact product page, never a search page presented as a product.
- **Never swap silently.** If the right size/variant isn't sold, say so in the item `note` and in the reply.

Scripts live in `scripts/` (Python 3.10+). Paths below are relative to this skill folder.

## Steps

1. **Settle the items.** Use the products the user named. For a goal, choose sensible items and say your assumptions in one line instead of asking a round of questions. Optional extras go on the list unticked (`"want": false`). Fill `brand`, `size` and variant words (colour, storage, model number, clothing size, formula, count) — matching depends on them. See `references/matching.md`.

2. **Find each item** at a store that sells to Saudi Arabia (SAR). Open the product page itself.
   - Groceries: Carrefour KSA, Panda, Tamimi, Danube, Nana, LuLu · pharmacy/beauty: Nahdi, Al-Dawaa, iHerb SA · electronics: Jarir, eXtra · home: IKEA Saudi · anything: Amazon.sa, noon.
   - Record the product page URL, size and the price only if you read it on that page now. Can't read it → `"price": null`.
   - Different size/variant than asked → write it in `note` (e.g. "Store sells 1 L, you asked 2 L").

3. **Write `list.json`** (format in `references/data-format.md`):
   ```json
   {"title": "Iced Matcha Latte", "currency": "SAR", "checked": "11 Oct 2026",
    "items": [{"name": "Almarai Full Fat Fresh Milk", "brand": "Almarai", "size": "2 L", "qty": 1,
               "store": "Carrefour KSA", "url": "https://www.carrefourksa.com/…/p/106475",
               "price": "12.50", "amazonUrl": null, "note": null, "want": true, "category": "Groceries"}]}
   ```

4. **Make the link** — pick ONE route:

   **A. Amazon list (when the user wants Amazon; Claude Code on the user's own computer only).**
   ```bash
   python3 scripts/amazon_list.py login        # first time: a visible browser opens; the USER signs in by hand
   python3 scripts/amazon_list.py create "Iced Matcha Latte" list.json --update-list list.json --out amazon-report.json
   ```
   - On first use, tell the user: "A browser window will open on amazon.sa — please sign in yourself, then tell me." Never ask for, type or store their password or codes. The script also waits and detects the sign-in.
   - The script searches each item, adds only listings whose brand/size/variant match, reads prices on the product page, creates the list, sets view-only sharing, and opens the link in a fresh no-cookie browser to confirm every item shows. It never clicks Buy / Checkout / Add to Cart.
   - Give the user `share_url` **only if** `verified_signed_out` is `true`. Report every `not_added` item with its reason (e.g. "Sary 400 g squeeze isn't on Amazon.sa").
   - If a step needs a click the script couldn't find, it shows a green banner in the browser telling the user what to click, then continues.
   - Details and troubleshooting: `references/amazon.md`.

   **B. GitHub Pages (no Amazon, or Claude Code without Amazon).**
   ```bash
   python3 scripts/publish_pages.py list.json
   ```
   - Uses the user's `gh` login; creates public repo `cartflow-lists` if missing; list at `/l/<random-id>/`.
   - Before the first publish, warn once: "the repo is public, so the list contents are public." If the list has anything personal (names, address, phone, health items), **ask before publishing**.
   - Re-running with the same `list.json` keeps the same URL (id saved in `pagesId`) and never duplicates items. `--add` merges new items into the live list.
   - It waits for Pages to deploy and checks the page signed-out; only give the link when it prints `"verified_signed_out": true`. Details: `references/pages.md`.

   **C. Single file (claude.ai, or when A/B aren't available).**
   ```bash
   python3 scripts/build_list.py list.json -o iced-matcha-latte-list.html
   ```
   Without code execution: copy `assets/list-template.html` exactly and replace only the JSON inside `<script type="application/json" id="list-data">`. Escape every `<` in the JSON as `\u003c`. Then send the file. In claude.ai you may also show it as an artifact: "Download CSV" hides itself there (downloads don't work in artifacts) and "Copy my list" still works. A private artifact needs a login, so the shareable thing is the file.

5. **Check before replying.** `build_list.py` / `publish_pages.py` validate links (https only, Amazon links must be `/dp/` product pages, prices need the page they came from), remove duplicates and print the ticked total. Fix any ERROR they print — never work around it.

6. **Reply in 2–3 short lines plus the link.** What's on it, the ticked total (say "incomplete" if some prices weren't checked), assumptions, and anything not found. No tables or long explanations unless asked.

   Example: *"Iced Matcha Latte — 4 items, Amazon list (view-only, checked signed-out). Sary 400 g squeeze isn't on Amazon.sa, so it's not on the Amazon list. https://www.amazon.sa/hz/wishlist/ls/…"*

## The list page

- Tick/untick items, change quantities (1–99); the total covers ticked items only, in whole halalas, and says **incomplete** when a ticked item has no checked price.
- Mixed lists are grouped by category (set `category`, or it is guessed: Groceries, Electronics, Fashion, Beauty, Baby, Home).
- Each item: exact store link (a search link is labelled "Search …"), plus an Amazon.sa link — the exact product if `amazonUrl` is set, otherwise "Search Amazon.sa ↗".
- "Copy my list" works everywhere (clipboard, or a selectable text box fallback). "Download CSV" starts with a byte-order mark so Excel shows Arabic correctly.
- If `amazonListUrl` is set, a banner links to the whole Amazon list.

## Changes later

Edit the same `list.json` ("make the milk 3", "remove the frother", "add vanilla syrup") and re-run the same script: same file name / same Pages URL / same Amazon list (existing items are not added twice). Never remove items unless asked.

## Never

- add to a cart, buy, check out, or click Buy / Add to Cart;
- ask for, type, read or store passwords, OTPs or card details;
- commit `.amazon-profile/` or any token (they're in `.gitignore`);
- invent prices, stock or product links, or present a search page as a product;
- publish anything personal without asking first.

## Tests

`python3 tests/run_all.py` — unit, browser, Pages (local) and offline Amazon tests. The live Amazon run needs the user's computer (see `references/amazon.md`).
