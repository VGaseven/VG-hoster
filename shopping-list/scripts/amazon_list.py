#!/usr/bin/env python3
"""Make a real Amazon.sa list (view-only share link) in a visible browser on your own computer.

  python3 scripts/amazon_list.py login                         # open amazon.sa; you sign in by hand
  python3 scripts/amazon_list.py create "Iced Matcha Latte" items.json [--out report.json]
  python3 scripts/amazon_list.py create "Iced Matcha Latte" items.json --dry-run   # search + match only

How it works
  * Uses a persistent browser profile folder (default ./.amazon-profile, keep it out of git) so you sign in once.
    The script never asks for, types or stores your password or codes. If you're signed out it shows a banner
    in the browser and waits until you have signed in yourself.
  * For each item: searches amazon.sa, opens candidate product pages, keeps only a listing whose brand, size and
    variant match (see listlib.match_product), reads the price on the product page, and adds it to the list named
    after the topic (created if needed). If nothing matches, the item is NOT added and the reason is reported.
  * Sets the list to view-only sharing, takes its link, opens that link in a fresh browser with no cookies and
    checks every added item is visible. Only then is "share_url" filled in the report.
  * Never clicks Buy / Checkout / Add to Cart: those clicks are refused and those URLs are blocked.

Items file: list JSON ({"title":..., "items":[...]}) or a plain array. Item fields used: name, brand, size, variant,
query (optional search text), amazonUrl (optional exact product link you pasted).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus

sys.path.insert(0, str(Path(__file__).resolve().parent))
import listlib  # noqa: E402

BASE = "https://www.amazon.sa"
LANG = "language=en_AE"

# ───────────────────────────── safety guards ─────────────────────────────
FORBIDDEN_TEXT = re.compile(
    r"add\s*to\s*(cart|basket|bag)|buy\s*now|proceed\s*to\s*(checkout|buy)|check\s*out|checkout|place\s*(your\s*)?order|"
    r"subscribe\s*&\s*save|one-click|1-click|أضف\s*إلى\s*(عربة|السلة)|اشتر\w*\s*الآن|إتمام\s*الشراء|الدفع", re.I)
FORBIDDEN_ID = re.compile(r"add-to-cart|addtocart|buy-now|buynow|checkout|submit\.add-to-cart|turbo-checkout|one-click", re.I)
FORBIDDEN_URL = re.compile(r"/gp/buy/|/checkout|/cart/add|/gp/add-to-cart|/gp/aws/cart|/gp/item-dispatch|/gp/cart/|/cart/smart-wagon|"
                           r"/gp/product/handle-buy-box|/afx/", re.I)
SECRET_FIELD = re.compile(r"password|passwd|otp|one-time|verification|cvv|card", re.I)


class SafetyError(RuntimeError):
    pass


def describe(locator) -> str:
    return locator.evaluate(
        "e => [e.id, e.name, e.getAttribute('aria-label'), e.getAttribute('value'), e.getAttribute('title'),"
        " e.getAttribute('formaction'), e.getAttribute('href'), (e.innerText||'').slice(0,200)].filter(Boolean).join(' | ')")


def safe_click(locator, **kw):
    """Click only if the element is not a cart / buy / checkout control."""
    info = describe(locator)
    if FORBIDDEN_TEXT.search(info) or FORBIDDEN_ID.search(info) or FORBIDDEN_URL.search(info):
        raise SafetyError(f"Refused to click a purchase control: {info[:120]}")
    locator.click(**kw)


def safe_fill(locator, text: str):
    """Fill a text box, but never a password / OTP / card field."""
    info = locator.evaluate("e => [e.type, e.name, e.id, e.autocomplete, e.getAttribute('aria-label')].join(' ')")
    if SECRET_FIELD.search(info):
        raise SafetyError("Refused to type into a password / code field")
    locator.fill(text)


def install_guards(context):
    """Block purchase URLs for every page in this browser context."""
    def handler(route):
        if FORBIDDEN_URL.search(route.request.url):
            print(f"[guard] blocked {route.request.url[:100]}", file=sys.stderr)
            return route.abort()
        return route.fallback()
    context.route("**/*", handler)


def banner(page, text: str):
    """Show a message at the top of the visible browser window (for the person at the laptop)."""
    try:
        page.evaluate("""t => { let b = document.getElementById('__sl_banner');
          if (!b) { b = document.createElement('div'); b.id='__sl_banner';
            b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0b6b53;color:#fff;'+
              'font:16px system-ui;padding:12px 16px;text-align:center;box-shadow:0 2px 8px #0005;pointer-events:none';
            document.documentElement.appendChild(b); }
          b.textContent = t; }""", text)
    except Exception:  # page navigating
        pass


# ───────────────────────────── page reading (pure JS, testable on fixtures) ─────────────────────────────
SEARCH_JS = r"""() => Array.from(document.querySelectorAll('div[data-component-type="s-search-result"][data-asin]'))
  .filter(el => /^[A-Z0-9]{10}$/.test(el.dataset.asin))
  .map((el, i) => {
    const h2 = el.querySelector('h2');
    const title = (h2 && (h2.getAttribute('aria-label') || h2.innerText) || '').replace(/^Sponsored Ad\s*[-–]\s*/i, '').trim();
    const price = el.querySelector('.a-price:not(.a-text-price) .a-offscreen');
    return { asin: el.dataset.asin, title, pos: i,
             sponsored: !!el.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text, [aria-label="View Sponsored information or leave ad feedback"]'),
             price: price ? price.textContent.trim() : null };
  })"""

PRODUCT_JS = r"""() => {
  const t = s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const priceSel = ['#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen', '#corePrice_feature_div .a-price .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen', '#apex_desktop .a-price .a-offscreen', '#price_inside_buybox', '#priceblock_ourprice'];
  let price = null;
  for (const s of priceSel) { const v = t(s); if (/\d/.test(v)) { price = v; break; } }
  if (!price) { const w = t('#corePriceDisplay_desktop_feature_div .a-price-whole'), f = t('#corePriceDisplay_desktop_feature_div .a-price-fraction');
    if (/\d/.test(w)) price = w.replace(/[^\d,]/g, '') + '.' + (f.replace(/\D/g, '') || '00'); }
  const facts = {};
  document.querySelectorAll('#productOverview_feature_div tr, #productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr').forEach(tr => {
    const c = tr.querySelectorAll('th, td'); if (c.length >= 2) facts[c[0].textContent.trim().toLowerCase()] = c[c.length - 1].textContent.replace(/\s+/g, ' ').trim(); });
  document.querySelectorAll('#detailBullets_feature_div li').forEach(li => { const m = li.textContent.replace(/\s+/g, ' ').match(/^\s*([^:]+?)\s*:\s*(.+)$/);
    if (m) facts[m[1].replace(/[^\w ]/g, '').trim().toLowerCase()] = m[2].trim(); });
  const byline = t('#bylineInfo').replace(/^(Visit the|Brand:)\s*/i, '').replace(/\s*Store$/i, '');
  const avail = t('#availability');
  const canon = document.querySelector('link[rel=canonical]');
  return { title: t('#productTitle'), price, brand: facts['brand'] || facts['brand name'] || byline || null,
           size: facts['size'] || facts['net quantity'] || facts['item weight'] || facts['net content volume'] || facts['item volume'] || null,
           colour: facts['colour'] || facts['color'] || null, model: facts['model name'] || facts['item model number'] || null,
           availability: avail, canonical: canon ? canon.href : location.href };
}"""

LIST_ASINS_JS = r"""() => { const out = new Set();
  const root = document.querySelector('#g-items') || document.querySelector('#wishlist-page') || document.body;
  root.querySelectorAll('[data-reposition-action-params]').forEach(e => { const m = (e.getAttribute('data-reposition-action-params') || '').match(/ASIN:([A-Z0-9]{10})/); if (m) out.add(m[1]); });
  root.querySelectorAll('a[href*="/dp/"]').forEach(a => { const m = a.getAttribute('href').match(/\/dp\/([A-Z0-9]{10})/); if (m) out.add(m[1]); });
  return Array.from(out); }"""


# ───────────────────────────── matching helpers (pure) ─────────────────────────────
def core_tokens(item: dict) -> list[str]:
    text = item.get("must") or item.get("name", "")
    if isinstance(text, list):
        text = " ".join(text)
    brand = set(listlib.tokens(item.get("brand") or ""))
    return [t for t in listlib.tokens(text) if len(t) > 2 and t not in brand and not listlib.UNIT_TOKEN.match(t)]


def relevant(item: dict, title: str) -> bool:
    """Every core word of the request must appear in the listing title (so a 'milk jug' never stands in for 'milk frother')."""
    have = {listlib.canonical_word(t) for t in listlib.tokens(title)}
    flat = listlib.norm(title).replace("-", "")
    return all(listlib.canonical_word(t) in have or t.replace("-", "") in flat for t in core_tokens(item))


def requested_of(item: dict) -> dict:
    return {"brand": item.get("brand"), "name": item.get("name"), "size": item.get("size"), "variant": item.get("variant")}


def rank_candidates(item: dict, results: list[dict]) -> list[dict]:
    """Search results worth opening, best first. Drops irrelevant ones and ones whose title already shows a mismatch."""
    req = requested_of(item)
    ranked = []
    for r in results:
        if not r.get("title") or not relevant(item, r["title"]):
            continue
        m = listlib.match_product(req, {"name": r["title"]})
        if m["status"] == "similar":
            continue
        order = {"exact": 0, "equivalent": 1, "unverified": 2}.get(m["status"], 3)
        ranked.append((order, 1 if r.get("sponsored") else 0, r.get("pos", 99), r))
    return [r for *_, r in sorted(ranked, key=lambda x: x[:3])]


def judge_product(item: dict, prod: dict) -> dict:
    """Match a product page against the request. Returns {ok, match, reason}."""
    listing = {"brand": prod.get("brand"), "name": prod.get("title"),
               "size": prod.get("size") if not listlib.parse_size(prod.get("title") or "") else None,
               "variant": " ".join(x for x in (prod.get("colour"), prod.get("model")) if x) or None}
    av = (prod.get("availability") or "").lower()
    if re.search(r"currently unavailable|out of stock|غير متوفر", av):
        listing["availability"] = "out_of_stock"
    m = listlib.match_product(requested_of(item), listing)
    if not prod.get("title"):
        return {"ok": False, "match": m, "reason": "product page did not load"}
    if not relevant(item, prod["title"]):
        return {"ok": False, "match": m, "reason": "not the same kind of product"}
    if not listlib.is_acceptable(m):
        return {"ok": False, "match": m, "reason": f"{m['status']}: " + "; ".join(m["differences"])}
    return {"ok": True, "match": m, "reason": ""}


def load_items(path: str) -> tuple[str | None, list[dict]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        return None, data
    return data.get("title"), data["items"]


# ───────────────────────────── browser steps ─────────────────────────────
def is_signed_in(page) -> bool:
    try:
        txt = page.locator("#nav-link-accountList-nav-line-1").first.inner_text(timeout=5000)
    except Exception:
        return False
    return bool(txt) and not re.search(r"sign\s*in|تسجيل", txt, re.I)


def wait_for_sign_in(page, timeout: int) -> bool:
    page.goto(f"{BASE}/?{LANG}", wait_until="domcontentloaded")
    if is_signed_in(page):
        return True
    print("Please sign in to amazon.sa in the browser window. I'll wait; I never see or type your password.", file=sys.stderr)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "amazon.sa" in page.url and "/ap/" not in page.url:
            banner(page, "Shopping-list helper: please sign in to Amazon yourself. I'll continue automatically when you're signed in.")
            if is_signed_in(page):
                return True
            # reload occasionally so the header reflects the new session
            if int(time.time()) % 20 < 3:
                try:
                    page.goto(f"{BASE}/?{LANG}", wait_until="domcontentloaded")
                except Exception:
                    pass
        time.sleep(3)
    return False


def search(page, item: dict) -> list[dict]:
    name = item.get("name") or ""
    extra = [x for x in (item.get("brand"), item.get("size")) if x and listlib.norm(x) not in listlib.norm(name)]
    q = item.get("query") or " ".join(([extra[0]] if item.get("brand") in extra else []) + [name] + [x for x in extra if x != item.get("brand")])
    page.goto(f"{BASE}/s?k={quote_plus(q)}&{LANG}", wait_until="domcontentloaded")
    try:
        page.wait_for_selector('div[data-component-type="s-search-result"]', timeout=15000)
    except Exception:
        return []
    return page.evaluate(SEARCH_JS)


def read_product(page, asin: str) -> dict:
    page.goto(f"{BASE}/dp/{asin}?{LANG}", wait_until="domcontentloaded")
    try:
        page.wait_for_selector("#productTitle", timeout=15000)
    except Exception:
        pass
    prod = page.evaluate(PRODUCT_JS)
    prod["asin"] = asin
    return prod


def pick(page, item: dict, max_open: int = 4) -> dict:
    """Find the matching Amazon listing for one item. Returns a result dict (ok or not, with reason)."""
    if item.get("amazonUrl"):
        c = listlib.classify_url(item["amazonUrl"])
        if c["kind"] != "product":
            return {"ok": False, "reason": "the Amazon link you gave is not a product page"}
        prod = read_product(page, c["id"])
        j = judge_product(item, prod)
        # A link you pasted is your choice: keep it even if the title wording differs, but report the difference.
        return {"ok": bool(prod.get("title")), "asin": c["id"], "product": prod, "match": j["match"], "reason": j["reason"] or ""}
    results = search(page, item)
    if not results:
        return {"ok": False, "reason": "no Amazon.sa search results (or Amazon showed a robot check)"}
    tried = []
    for cand in rank_candidates(item, results)[:max_open]:
        prod = read_product(page, cand["asin"])
        j = judge_product(item, prod)
        if j["ok"]:
            return {"ok": True, "asin": cand["asin"], "product": prod, "match": j["match"], "reason": ""}
        tried.append(f"{(prod.get('title') or cand['title'])[:70]} → {j['reason']}")
    if not tried:
        return {"ok": False, "reason": "no listing with the right brand/size/variant in the results"}
    return {"ok": False, "reason": "closest listings don't match: " + " | ".join(tried[:3])}


def find_list_id(page, list_name: str) -> str | None:
    page.goto(f"{BASE}/hz/wishlist/ls?{LANG}", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    links = page.evaluate(r"""() => Array.from(document.querySelectorAll('a[href*="/hz/wishlist/ls/"]'))
        .map(a => ({ id: (a.getAttribute('href').match(/\/hz\/wishlist\/ls\/([A-Z0-9]{10,16})/) || [])[1], text: (a.innerText || a.title || '').trim() }))
        .filter(x => x.id)""")
    want = listlib.norm(list_name)
    for link in links:
        if listlib.norm(link["text"]) == want:
            return link["id"]
    return None


def create_list(page, list_name: str, wait_human: int) -> str:
    """Create a private list with this name (if it doesn't exist) and return its id."""
    existing = find_list_id(page, list_name)
    if existing:
        return existing
    page.goto(f"{BASE}/hz/wishlist/ls?{LANG}", wait_until="domcontentloaded")
    try:
        safe_click(page.get_by_role("link", name=re.compile(r"create a list|create another list|إنشاء قائمة", re.I)).or_(
            page.get_by_role("button", name=re.compile(r"create a list|create another list|إنشاء قائمة", re.I))).first, timeout=8000)
        box = page.locator("#list-name, input[name='listName'], input[aria-label*='List name' i]").first
        box.wait_for(timeout=8000)
        safe_fill(box, list_name)
        safe_click(page.get_by_role("button", name=re.compile(r"^\s*create list\s*$|إنشاء", re.I)).or_(
            page.locator("#wl-redesigned-create-list input, span.a-button-primary input[aria-labelledby*='create' i]")).first, timeout=8000)
        page.wait_for_timeout(3000)
    except SafetyError:
        raise
    except Exception:
        banner(page, f'Shopping-list helper: please click "Create a List", name it "{list_name}" and press Create. I\'ll continue.')
        deadline = time.time() + wait_human
        while time.time() < deadline:
            time.sleep(4)
            m = re.search(r"/hz/wishlist/ls/([A-Z0-9]{10,16})", page.url)
            if m and listlib.norm(page.title()).find(listlib.norm(list_name)) >= 0:
                return m.group(1)
    lid = find_list_id(page, list_name)
    if not lid:
        raise RuntimeError(f'could not create the list "{list_name}"')
    return lid


def list_asins(page, list_id: str) -> list[str]:
    page.goto(f"{BASE}/hz/wishlist/ls/{list_id}?{LANG}", wait_until="domcontentloaded")
    for _ in range(20):  # lists load more items as you scroll
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(500)
        if page.locator("#endOfListMarker, #no-items-section").count():
            break
    return page.evaluate(LIST_ASINS_JS)


def add_to_list(page, asin: str, list_name: str, list_id: str, wait_human: int) -> bool:
    """Add one product to the named list from its product page. Uses only the 'Add to List' control."""
    page.goto(f"{BASE}/dp/{asin}?{LANG}", wait_until="domcontentloaded")
    try:
        dropdown = page.locator("#add-to-wishlist-button, #wishListDropDown, #add-to-wishlist-button-group .a-button-dropdown").first
        dropdown.wait_for(timeout=10000)
        safe_click(dropdown)
        page.wait_for_timeout(1500)
        entry = page.locator(f"#atwl-list-name-{list_id}, [id^='atwl-link-to-list-{list_id}']").or_(
            page.locator("#atwl-popover-inner, .a-popover-wrapper").get_by_text(list_name, exact=True)).first
        entry.wait_for(timeout=8000)
        safe_click(entry)
        page.wait_for_timeout(2500)
    except SafetyError:
        raise
    except Exception:
        banner(page, f'Shopping-list helper: please click "Add to List" ▾ and choose "{list_name}" (NOT Add to Cart). I\'ll continue.')
        deadline = time.time() + wait_human
        while time.time() < deadline:
            time.sleep(5)
            if page.get_by_text(re.compile(r"added to|تمت إضافة", re.I)).count():
                break
    return True


def share_view_only(page, list_id: str, wait_human: int) -> str | None:
    """Turn on view-only sharing and return the share link."""
    page.goto(f"{BASE}/hz/wishlist/ls/{list_id}?{LANG}", wait_until="domcontentloaded")
    link = None
    try:
        safe_click(page.get_by_role("link", name=re.compile(r"send list to others|invite|share", re.I)).or_(
            page.get_by_role("button", name=re.compile(r"send list to others|invite|share", re.I))).first, timeout=8000)
        page.wait_for_timeout(1500)
        safe_click(page.get_by_text(re.compile(r"view only|للعرض فقط", re.I)).first, timeout=8000)
        page.wait_for_timeout(2000)
        link = page.evaluate(r"""() => { const t = Array.from(document.querySelectorAll('input, textarea, a, span'))
              .map(e => e.value || e.href || e.textContent || '').find(v => /amazon\.sa\/hz\/wishlist\/ls\/[A-Z0-9]+/.test(v));
              return t ? t.match(/https:\/\/www\.amazon\.sa\/hz\/wishlist\/ls\/[A-Z0-9]+[^\s"']*/)[0] : null; }""")
        if not link:
            safe_click(page.get_by_role("button", name=re.compile(r"copy link|نسخ", re.I)).first, timeout=5000)
            page.wait_for_timeout(800)
            link = page.evaluate("() => navigator.clipboard.readText().catch(() => null)")
    except SafetyError:
        raise
    except Exception:
        banner(page, 'Shopping-list helper: please click "Send list to others" → "View only" → "Copy link". I\'ll pick it up.')
        deadline = time.time() + wait_human
        while time.time() < deadline and not link:
            time.sleep(3)
            try:
                link = page.evaluate("() => navigator.clipboard.readText().catch(() => null)")
            except Exception:
                link = None
            if link and not re.search(r"/hz/wishlist/ls/", link):
                link = None
    if link:
        c = listlib.classify_url(link.strip())
        if c["kind"] == "list" and c["id"] == list_id.upper():
            return link.strip()
    return None


def verify_signed_out(pw, url: str, asins: list[str], headless: bool) -> tuple[bool, list[str]]:
    """Open the share link in a brand-new browser with no cookies; return (all present, missing ASINs)."""
    browser = pw.chromium.launch(headless=headless)
    try:
        ctx = browser.new_context(locale="en-US")
        install_guards(ctx)
        page = ctx.new_page()
        page.goto(url + ("&" if "?" in url else "?") + LANG, wait_until="domcontentloaded")
        for _ in range(20):
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(500)
            if page.locator("#endOfListMarker").count():
                break
        seen = set(page.evaluate(LIST_ASINS_JS))
        signed_in = is_signed_in(page)
    finally:
        browser.close()
    missing = [a for a in asins if a not in seen]
    return (not missing and not signed_in), missing


# ───────────────────────────── commands ─────────────────────────────
def open_profile(pw, profile: str, channel: str | None):
    Path(profile).mkdir(parents=True, exist_ok=True)
    ctx = pw.chromium.launch_persistent_context(
        profile, headless=False, channel=channel, locale="en-US", viewport=None,
        ignore_default_args=["--enable-automation"], permissions=["clipboard-read", "clipboard-write"])
    install_guards(ctx)
    return ctx


def cmd_login(args) -> int:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = open_profile(pw, args.profile, args.channel)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        ok = wait_for_sign_in(page, args.login_timeout)
        if ok:
            banner(page, "Signed in. You can close this window; the session is saved in the profile folder.")
            page.wait_for_timeout(2000)
        ctx.close()
    print(json.dumps({"signed_in": ok}))
    return 0 if ok else 1


def cmd_create(args) -> int:
    from playwright.sync_api import sync_playwright
    title, items = load_items(args.items)
    list_name = args.list_name or title
    report = {"list_name": list_name, "added": [], "not_added": [], "share_url": None, "verified_signed_out": False}
    with sync_playwright() as pw:
        ctx = open_profile(pw, args.profile, args.channel)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            if not args.dry_run and not wait_for_sign_in(page, args.login_timeout):
                report["error"] = "not signed in (timed out waiting for you to sign in)"
                return finish(report, args)
            picks = []
            for item in items:
                r = pick(page, item)
                if r["ok"]:
                    prod = r["product"]
                    h = listlib.to_halalas(prod.get("price"))
                    picks.append({"name": item["name"], "asin": r["asin"], "url": f"{BASE}/dp/{r['asin']}", "title": prod.get("title"),
                                  "price": None if h is None else f"{h // 100}.{h % 100:02d}", "match": r["match"]["status"],
                                  "notes": r["match"]["differences"]})
                else:
                    report["not_added"].append({"name": item["name"], "reason": r["reason"]})
            if args.dry_run:
                report["would_add"] = picks
                return finish(report, args)
            list_id = create_list(page, list_name, args.human_timeout)
            report["list_id"] = list_id
            present = set(list_asins(page, list_id))
            for p in picks:
                if p["asin"] not in present:
                    add_to_list(page, p["asin"], list_name, list_id, args.human_timeout)
            present = set(list_asins(page, list_id))
            for p in picks:
                if p["asin"] in present:
                    report["added"].append(p)
                else:
                    report["not_added"].append({"name": p["name"], "reason": "could not add it to the list (Amazon page changed?)", "asin": p["asin"]})
            if report["added"]:
                link = share_view_only(page, list_id, args.human_timeout)
                if not link:
                    report["error"] = "could not get the view-only share link"
                else:
                    ok, missing = verify_signed_out(pw, link, [p["asin"] for p in report["added"]], headless=args.verify_headless)
                    report["verified_signed_out"] = ok
                    if ok:
                        report["share_url"] = link
                    else:
                        report["error"] = ("signed-out view is missing: " + ", ".join(missing)) if missing else "list did not open signed-out (still private?)"
                        report["unverified_link"] = link
        except SafetyError as e:
            report["error"] = f"stopped for safety: {e}"
        finally:
            ctx.close()
    return finish(report, args)


def finish(report: dict, args) -> int:
    if args.update_list and report.get("added"):
        p = Path(args.update_list)
        data = json.loads(p.read_text(encoding="utf-8"))
        by_name = {a["name"]: a for a in report["added"]}
        for it in data["items"]:
            a = by_name.get(it["name"])
            if a:
                it["amazonUrl"] = a["url"]
                if a["price"] and (not it.get("url") or it.get("store") in (None, "Amazon.sa")):
                    it.update({"price": a["price"], "store": "Amazon.sa", "url": a["url"]})
        if report.get("share_url"):
            data["amazonListUrl"] = listlib.classify_url(report["share_url"])["canonical"]
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)
    return 0 if (report.get("share_url") or getattr(args, "dry_run", False)) and not report.get("error") else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", default=".amazon-profile", help="persistent browser profile folder (keep out of git)")
    ap.add_argument("--channel", default=None, help="'chrome' to use your installed Google Chrome instead of Playwright Chromium")
    ap.add_argument("--login-timeout", type=int, default=900, help="seconds to wait for you to sign in")
    ap.add_argument("--human-timeout", type=int, default=180, help="seconds to wait when a step needs your click")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    c = sub.add_parser("create")
    c.add_argument("list_name", nargs="?", help="list name (default: title in the items file)")
    c.add_argument("items")
    c.add_argument("--out", help="write the JSON report here too")
    c.add_argument("--update-list", help="list JSON to update with Amazon links/prices and the list link")
    c.add_argument("--dry-run", action="store_true", help="search and match only; change nothing on Amazon")
    c.add_argument("--verify-headless", action="store_true", help="run the signed-out check without a window")
    args = ap.parse_args(argv)
    return cmd_login(args) if args.cmd == "login" else cmd_create(args)


if __name__ == "__main__":
    sys.exit(main())
