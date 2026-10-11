"""Shared helpers for the shopping-list skill.

Pure functions only (no network, no browser), so they can be unit-tested:
  - money: prices in whole halalas (integers), totals of ticked items
  - URLs: product page vs search / category / list / homepage
  - matching: does a store listing match what the user asked for (any category)
  - building the list page from assets/list-template.html

Matching and URL rules are a Python port of core/cartflow-core.js (CartFlow v6).
"""
from __future__ import annotations

import json
import re
import secrets
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit, quote_plus

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_DIR / "assets" / "list-template.html"
MAX_QTY = 99

# ───────────────────────────── money ─────────────────────────────

def to_halalas(price) -> int | None:
    """'43.50' -> 4350, 'SAR 1,299.5' -> 129950, 'ر.س 12.95' -> 1295. None if not a price.

    Rounds half-up on the third decimal. Never uses floats.
    """
    if price is None or isinstance(price, bool):
        return None
    if isinstance(price, int):
        return price * 100
    s = str(price).strip()
    # Arabic-Indic digits -> ASCII, Arabic decimal separator -> '.'
    s = s.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫٬", "01234567890123456789.,"))
    m = re.search(r"\d[\d,]*(?:\.\d+)?|\.\d+", s)
    if not m:
        return None
    num = m.group(0).replace(",", "")
    whole, _, frac = num.partition(".")
    frac = frac + "000"
    h = int(whole or "0") * 100 + int(frac[:2])
    if int(frac[2]) >= 5:
        h += 1
    return h


def format_halalas(h: int, currency: str = "SAR") -> str:
    return f"{currency} {h // 100:,}.{h % 100:02d}"


def clamp_qty(q) -> int:
    try:
        q = int(q)
    except (TypeError, ValueError):
        q = 1
    return max(1, min(MAX_QTY, q))


def totals(items) -> dict:
    """Total of ticked items only. Items without a checked price are counted as missing.

    Returns {total, ticked, unpriced, complete} with total in halalas.
    """
    total = ticked = unpriced = 0
    for it in items:
        if it.get("want") is False:
            continue
        ticked += 1
        h = to_halalas(it.get("price"))
        if h is None:
            unpriced += 1
        else:
            total += h * clamp_qty(it.get("qty", 1))
    return {"total": total, "ticked": ticked, "unpriced": unpriced, "complete": unpriced == 0}


# ───────────────────────────── text + size ─────────────────────────────

STOP_WORDS = {"the", "for", "and", "with", "of", "a", "an", "to", "in", "all", "hair", "types", "type", "men", "women", "new", "by"}


def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "").lower())
    s = re.sub(r"[̀-ͯ]", "", s)
    s = re.sub(r"[™®©]", "", s)
    s = re.sub(r"[^a-z0-9؀-ۿ.\s-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(s) -> list[str]:
    return [t for t in re.split(r"[\s-]+", norm(s)) if t and t not in STOP_WORDS and not re.fullmatch(r"\d+(\.\d+)?", t)]


ML_PER = {"ml": 1, "l": 1000, "floz": 29.5735}
G_PER = {"g": 1, "kg": 1000, "oz": 28.3495, "mg": 0.001}


def _round1(n: float) -> float:
    return int(n * 10 + 0.5) / 10


def parse_size(text):
    """'250 ml', '8.45 fl. oz.', '2 x 250ml', 'Pack of 3', '30g' -> {amount, unit, pack} or None."""
    t = re.sub(r"fl\.?\s*oz\.?", "floz", norm(text))
    t = re.sub(r"(\d)\s*(kilo ?grams?|kilos?)\b", r"\1kg", t)
    t = re.sub(r"(\d)\s*(milli ?lit(?:er|re)s?)\b", r"\1ml", t)
    t = re.sub(r"(\d)\s*(grams?|gms?|gr)\b", r"\1g", t)
    t = re.sub(r"(\d)\s*(lit(?:er|re)s?|ltrs?|lt)\b", r"\1l", t)
    t = re.sub(r"(\d)\s*(ounces?)\b", r"\1oz", t)
    t = re.sub(r"(\d),(\d)", r"\1.\2", t)
    pack = 1
    pm = (re.search(r"(?:pack of|set of)\s*(\d+)", t) or re.search(r"\b(\d+)\s*(?:x|×)\s*\d", t)
          or re.search(r"\b(\d+)\s*(?:pack|pcs|pieces)\b", t))
    if pm:
        pack = int(pm.group(1))
    m = re.search(r"(\d+(?:\.\d+)?)\s*(ml|l|floz|kg|mg|g|oz)\b", t)
    if not m:
        return {"amount": None, "unit": None, "pack": pack} if pm else None
    value, unit = float(m.group(1)), m.group(2)
    if unit in ML_PER:
        return {"amount": _round1(value * ML_PER[unit]), "unit": "ml", "pack": pack}
    return {"amount": _round1(value * G_PER[unit]), "unit": "g", "pack": pack}


def sizes_equal(a, b):
    if not a or not b or a["amount"] is None or b["amount"] is None:
        return None
    if a["unit"] != b["unit"]:
        return False
    return abs(a["amount"] - b["amount"]) <= max(a["amount"], b["amount"]) * 0.02


# ───────────────────────────── matching ─────────────────────────────

VARIANT_WORDS = [
    "sensitive", "repair", "daily", "hydration", "hydrating", "moisture", "moisturizing", "volume", "volumising", "volumizing",
    "color", "colour", "smoothing", "anti", "dandruff", "oily", "dry", "curl", "curly", "kids", "baby", "black", "purple",
    "yellow", "protein", "keratin", "argan", "tea", "tree", "coffee", "caffeine", "c1", "hybrid", "balm", "mask", "spray",
    "leave", "leave-in", "rinse", "oil", "serum", "shampoo", "conditioner", "weightless", "unscented", "fragrance", "free",
    "women", "men", "plus", "pro", "max", "mini", "travel", "refill",
    "ultra", "lite", "air", "wireless", "wired", "bluetooth", "usb", "usb-c", "lightning", "cellular", "wifi", "5g", "4g", "dual", "sim",
    "unlocked", "refurbished", "renewed", "used", "organic", "decaf", "unsweetened", "sugar", "zero", "diet", "lactose", "gluten", "vegan",
    "halal", "spicy", "mild", "salted", "unsalted", "whole", "skimmed", "left", "right", "xl", "xxl", "adult", "junior", "newborn",
    # added for this skill: fat level, formula and grade words that change the product
    "full", "low", "light", "culinary", "ceremonial", "matte", "gloss", "spf", "fragrance-free",
]
SYNONYMS = [["grey", "gray"], ["renewed", "refurbished"], ["moisture", "hydration", "hydrating", "moisturizing", "moisturising"],
            ["color", "colour"], ["volume", "volumising", "volumizing"], ["coffee", "caffeine", "coffein", "koffein"],
            ["conditioner", "balm", "conditioning"], ["light", "lite"]]


def canonical_word(w: str) -> str:
    for group in SYNONYMS:
        if w in group:
            return group[0]
    return w


VARIANT_SET = {canonical_word(w) for w in VARIANT_WORDS}

COLORS = ["black", "white", "silver", "grey", "gray", "gold", "blue", "red", "green", "pink", "purple", "yellow", "orange", "brown",
          "beige", "navy", "rose", "titanium", "graphite", "midnight", "starlight", "cream", "ivory", "teal", "olive", "khaki",
          "burgundy", "charcoal", "transparent", "clear"]
UNIT_TOKEN = re.compile(r"^\d+(\.\d+)?(ml|l|g|kg|mg|mcg|iu|oz|floz|lb|gb|tb|mb|mah|w|kw|v|hz|mm|cm|m|inch|in|pcs|pc|ct|pk|x\d+|k|p|fps|mp|gen|th|st|nd|rd)$")


def attributes(text) -> dict:
    t = re.sub(r"(\d),(\d)", r"\1.\2", norm(text))
    storage = sorted(float(m.group(1)) * (1024 if m.group(2) == "tb" else 1) for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(tb|gb)\b", t))
    screen = re.search(r"(\d{1,3}(?:\.\d)?)\s*(?:-\s*)?(?:inch|inches)\b", t)
    count = (re.search(r"(\d+)\s*(?:count|ct|pcs|pieces)\b", t)
             or re.search(r"(?<!size\s)(?<!size)\b(\d+)\s*(?:tablets|tabs|capsules|caps|softgels|gummies|sheets|rolls|bags|pods|sachets|wipes|diapers|nappies|bottles|cans)\b", t))
    colors = []
    for c in COLORS:
        if re.search(r"\b" + c + r"\b", t):
            c = "grey" if c == "gray" else c
            if c not in colors:
                colors.append(c)
    models = [w for w in re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", t)
              if re.search(r"\d", w) and re.search(r"[a-z]", w) and len(w.replace("-", "")) >= 3
              and not UNIT_TOKEN.match(w.replace("-", "")) and not re.match(r"^\d+(x|×)\d+", w)]
    apparel = re.search(r"\bsize\s*(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,2}(?:\.5)?)\b", t) or re.search(r"\b(xxs|xs|xl|xxl|xxxl)\b", t)
    return {"storage": storage, "screen": float(screen.group(1)) if screen else None, "count": int(count.group(1)) if count else None,
            "colors": colors, "models": models, "apparel": apparel.group(1) if apparel else None}


def compare_attributes(requested_text: str, listing_text: str) -> dict:
    r, l = attributes(requested_text), attributes(listing_text)
    conflicts, unknown = [], []
    l_flat = norm(listing_text).replace("-", "")
    missing_models = [m for m in r["models"] if m.replace("-", "") not in l_flat]
    if missing_models:
        conflicts.append("Different model (asked " + ", ".join(missing_models) + ")")
    if r["storage"]:
        if not l["storage"]:
            unknown.append("Storage not shown")
        elif not all(v in l["storage"] for v in r["storage"]):
            conflicts.append("Different storage")
    if r["screen"] is not None:
        if l["screen"] is None:
            unknown.append("Screen size not shown")
        elif abs(r["screen"] - l["screen"]) > 0.2:
            conflicts.append(f"Different screen size: {l['screen']:g}\" (asked {r['screen']:g}\")")
    if r["count"] is not None:
        if l["count"] is None:
            unknown.append("Count not shown")
        elif r["count"] != l["count"]:
            conflicts.append(f"Different count: {l['count']} (asked {r['count']})")
    if r["colors"]:
        if not l["colors"]:
            unknown.append("Colour not shown")
        elif not any(c in l["colors"] for c in r["colors"]):
            conflicts.append("Different colour: " + "/".join(l["colors"]) + " (asked " + "/".join(r["colors"]) + ")")
    r_spf, l_spf = re.search(r"spf\s*(\d+)", norm(requested_text)), re.search(r"spf\s*(\d+)", norm(listing_text))
    if r_spf and l_spf and r_spf.group(1) != l_spf.group(1):
        conflicts.append(f"Different SPF: {l_spf.group(1)} (asked {r_spf.group(1)})")
    if r["apparel"] and l["apparel"] and r["apparel"] != l["apparel"]:
        conflicts.append(f"Different size: {l['apparel'].upper()} (asked {r['apparel'].upper()})")
    if r["apparel"] and not l["apparel"]:
        unknown.append("Clothing size not shown")
    return {"conflicts": conflicts, "unknown": unknown}


def _describe(s):
    return f"{s['amount']:g} {s['unit']}" if s and s.get("amount") is not None else "unknown size"


def match_product(requested: dict, listing: dict | None) -> dict:
    """Compare what the user asked for ({brand, name, size, variant}) with a store listing.

    status: exact | equivalent | similar (different brand/size/variant/model) | unverified | unavailable.
    Only exact and equivalent may be added to a list without asking the user.
    """
    if not listing or not listing.get("name"):
        return {"status": "unverified", "differences": ["No store listing found"]}
    diffs: list[str] = []
    rb, lb = norm(requested.get("brand")), norm(listing.get("brand"))
    listing_text = norm(" ".join(str(listing.get(k) or "") for k in ("brand", "name", "variant")))
    if rb and lb and rb != lb and rb not in listing_text:
        return {"status": "similar", "differences": ["Different brand: " + (listing.get("brand") or "?")]}
    if rb and not lb and rb.split(" ")[0] not in listing_text:
        diffs.append("Brand not shown on listing")

    rs = parse_size(" ".join(x for x in (requested.get("size"), requested.get("name")) if x))
    ls = parse_size(" ".join(x for x in (listing.get("size"), listing.get("name")) if x))
    size_eq = sizes_equal(rs, ls)
    if size_eq is False:
        diffs.append(f"Different size: {listing.get('size') or _describe(ls)} (asked {requested.get('size') or _describe(rs)})")
    pack_diff = bool(rs and ls and rs["pack"] != ls["pack"])
    if pack_diff:
        diffs.append(f"Pack of {ls['pack']} (asked {rs['pack']})")

    r_words = {canonical_word(w) for w in tokens(" ".join(str(requested.get(k) or "") for k in ("name", "variant")))}
    l_words = {canonical_word(w) for w in tokens(" ".join(str(listing.get(k) or "") for k in ("name", "variant")))}
    missing = sorted(w for w in r_words if w in VARIANT_SET and w not in l_words)
    extra = sorted(w for w in l_words if w in VARIANT_SET and w not in r_words and w != "coffee")
    if missing:
        diffs.append("Listing lacks: " + ", ".join(missing))
    attr = compare_attributes(" ".join(x for x in (requested.get("name"), requested.get("variant"), requested.get("size")) if x),
                              " ".join(x for x in (listing.get("name"), listing.get("variant"), listing.get("size")) if x))
    diffs.extend(attr["conflicts"])

    size_unknown = bool(rs and rs["amount"] is not None and size_eq is None)
    if listing.get("availability") in ("out_of_stock", "removed"):
        status = "unavailable"
    elif size_eq is False or pack_diff or missing or attr["conflicts"]:
        status = "similar"
    elif size_unknown or attr["unknown"]:
        status = "unverified"
        if size_unknown:
            diffs.append("Size could not be confirmed")
        diffs.extend(attr["unknown"])
    else:
        raw_r = set(tokens(" ".join(str(requested.get(k) or "") for k in ("name", "variant"))))
        raw_l = set(tokens(" ".join(str(listing.get(k) or "") for k in ("name", "variant"))))
        raw_missing = sorted(w for w in raw_r if w in VARIANT_WORDS and w not in raw_l)
        status = "equivalent" if raw_missing else "exact"
        if raw_missing:
            diffs.append("Named differently: " + ", ".join(raw_missing))
    if extra and status != "similar":
        diffs.append("Listing also says: " + ", ".join(extra))
    return {"status": status, "differences": diffs}


def is_acceptable(match: dict) -> bool:
    return match["status"] in ("exact", "equivalent")


def identity_key(item: dict) -> str:
    """Same product -> same key, used to stop duplicates when a list is updated."""
    size = parse_size(" ".join(x for x in (item.get("size"), item.get("name")) if x))
    size_key = f"{round(size['amount'])}{size['unit']}" if size and size["amount"] is not None else "nosize"
    pack = size["pack"] if size else 1
    words = sorted({canonical_word(w) for w in tokens(" ".join(str(item.get(k) or "") for k in ("brand", "name", "variant")))})
    return "|".join([norm(item.get("brand")), "+".join(words), size_key, f"x{pack}"])


def dedupe(items: list[dict]) -> list[dict]:
    """Keep the first of each product; later copies update price/links/qty instead of adding a row."""
    out, seen = [], {}
    for it in items:
        k = identity_key(it)
        if k in seen:
            seen[k].update({key: v for key, v in it.items() if v not in (None, "") and key != "name"})
        else:
            seen[k] = dict(it)
            out.append(seen[k])
    return out


# ───────────────────────────── URLs ─────────────────────────────

RETAILERS = [
    ("amazon", "Amazon.sa", r"(^|\.)amazon\.(sa|ae|com|co\.uk|de|eg|in)$"), ("noon", "noon", r"(^|\.)noon\.com$"),
    ("iherb", "iHerb", r"(^|\.)iherb\.com$"), ("nahdi", "Nahdi", r"(^|\.)nahdionline\.com$"),
    ("aldawaa", "Al-Dawaa", r"(^|\.)al-dawaa\.com$"), ("jarir", "Jarir", r"(^|\.)jarir\.com$"), ("extra", "eXtra", r"(^|\.)extra\.com$"),
    ("ikea", "IKEA", r"(^|\.)ikea\.com$"), ("carrefour", "Carrefour KSA", r"(^|\.)carrefourksa\.com$"), ("panda", "Panda", r"(^|\.)panda\.sa$"),
    ("tamimi", "Tamimi", r"(^|\.)tamimimarkets\.com$"), ("nana", "Nana", r"(^|\.)nana\.sa$"), ("danube", "Danube", r"(^|\.)danube\.sa$"),
    ("lulu", "LuLu", r"(^|\.)luluhypermarket\.com$"), ("namshi", "Namshi", r"(^|\.)namshi\.com$"), ("sephora", "Sephora", r"(^|\.)sephora\.(me|sa|com)$"),
]


def classify_url(raw) -> dict:
    """kind: product | search | category | list | list_dashboard | homepage | other | invalid."""
    s = str(raw or "").strip()
    try:
        u = urlsplit(s)
    except ValueError:
        return {"kind": "invalid", "reason": "Not a URL"}
    if u.scheme != "https" or not u.hostname:
        return {"kind": "invalid", "reason": "Only https links are allowed"}
    if u.username or u.password:
        return {"kind": "invalid", "reason": "Credentials in URL"}
    host = u.hostname.lower()
    if re.match(r"^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)", host) or re.match(r"^172\.(1[6-9]|2\d|3[01])\.", host) \
            or host.endswith((".internal", ".local")):
        return {"kind": "invalid", "reason": "Private network address"}
    bare = host[4:] if host.startswith("www.") else host
    retailer = next((r for r in RETAILERS if re.search(r[2], bare)), None)
    path, query = u.path or "/", u.query
    params = {p.split("=", 1)[0].lower() for p in query.split("&") if p}
    out = {"kind": "other", "retailer": retailer[0] if retailer else None, "store": retailer[1] if retailer else bare, "id": None, "canonical": None}
    if path in ("/", "") or re.fullmatch(r"/(-/)?(en|ar)(-[a-z]{2})?/?", path, re.I) or re.fullmatch(r"/(saudi-en|saudi-ar)/?", path, re.I):
        return {**out, "kind": "homepage"}
    if retailer and retailer[0] == "amazon":
        m = re.search(r"/(?:dp|gp/product|gp/aw/d|exec/obidos/asin)/([A-Z0-9]{10})(?:[/?]|$)", path, re.I)
        if m:
            asin = m.group(1).upper()
            return {**out, "kind": "product", "id": asin, "canonical": f"https://{host}/dp/{asin}"}
        m = re.search(r"/hz/wishlist/(?:ls|genericItemsPage)/([A-Z0-9]{10,16})", path, re.I)
        if m:
            return {**out, "kind": "list", "id": m.group(1).upper(), "canonical": f"https://{host}/hz/wishlist/ls/{m.group(1).upper()}"}
        if re.search(r"/hz/wishlist|/gp/registry|wishlist/(intro|your-lists)", path, re.I):
            return {**out, "kind": "list_dashboard"}
        if re.fullmatch(r"(/-/[a-z]{2})?(/[^/]+)?/s/?", path, re.I) or "k" in params:
            return {**out, "kind": "search"}
        if re.search(r"/b/?$|/b/|/gp/browse|/stores/", path, re.I):
            return {**out, "kind": "category"}
        return out
    if retailer and retailer[0] == "noon":
        m = re.search(r"/(N[A-Z0-9]{8,}[A-Z]?|Z[A-Z0-9]{8,})/p/?", path, re.I)
        if m:
            return {**out, "kind": "product", "id": m.group(1).upper(), "canonical": s.split("?")[0]}
        if re.search(r"/search", path, re.I) or "q" in params:
            return {**out, "kind": "search"}
        return {**out, "kind": "category"}
    if retailer and retailer[0] == "iherb":
        m = re.search(r"/pr/[^/]+/(\d+)", path, re.I)
        if m:
            return {**out, "kind": "product", "id": m.group(1), "canonical": f"https://{host}{path.rstrip('/')}"}
        return {**out, "kind": "search" if (re.search(r"/search", path, re.I) or "kw" in params) else "category"}
    if retailer and retailer[0] == "nahdi":
        m = re.search(r"/pdp/(\d+)", path, re.I)
        if m:
            return {**out, "kind": "product", "id": m.group(1), "canonical": f"https://{host}{path.rstrip('/')}"}
        if re.search(r"/search", path, re.I):
            return {**out, "kind": "search"}
        return {**out, "kind": "category"} if re.search(r"/plp/", path, re.I) else out
    if re.search(r"/(search|catalogsearch|s)(/|$)", path, re.I) or params & {"q", "query", "k", "kw", "search", "text"}:
        return {**out, "kind": "search"}
    if re.search(r"/(products?|p|pdp|dp|item|pr)/[^/]+", path, re.I) or re.search(r"-p-\d+|/\d{5,}(\.html)?/?$|-\d{5,}\.html$", path, re.I):
        return {**out, "kind": "product", "canonical": s.split("#")[0]}
    if re.search(r"/(collections?|category|categories|c|plp|shop)(/|$)", path, re.I):
        return {**out, "kind": "category"}
    return {**out, "canonical": s.split("#")[0]}


def amazon_search_url(name: str, size: str = "") -> str:
    return "https://www.amazon.sa/s?k=" + quote_plus((name + (" " + size if size else "")).strip())


# ───────────────────────────── categories ─────────────────────────────

CATEGORY_HINTS = [
    ("Electronics", r"\b(phone|iphone|galaxy|pixel|laptop|macbook|tablet|ipad|charger|cable|usb|headphones?|earbuds|airpods|monitor|tv|"
                    r"speaker|power ?bank|case|screen protector|keyboard|mouse|ssd|router|frother|camera|watch)\b"),
    ("Baby", r"\b(diapers?|nappies|pampers|huggies|baby|wipes|formula|pacifier|bottle nipple|stroller)\b"),
    ("Beauty", r"\b(shampoo|conditioner|serum|cream|lotion|moisturi[sz]er|sunscreen|spf|lipstick|mascara|perfume|cleanser|toner|deodorant)\b"),
    ("Fashion", r"\b(shirt|t-shirt|jeans|dress|abaya|thobe|shoes|sneakers|jacket|hoodie|socks|trousers|pants|skirt|size (xs|s|m|l|xl|xxl))\b"),
    ("Home", r"\b(chair|table|lamp|sofa|shelf|pillow|towel|sheet|bed|mug|glass(es)?|whisk|pan|pot|knife|storage|ikea)\b"),
    ("Groceries", r"\b(milk|honey|matcha|tea|coffee|sugar|syrup|ice|bread|eggs|rice|flour|oil|cheese|yogh?urt|water|juice|fruit|"
                  r"vegetables?|chicken|meat|dates|spice|salt|pasta|cereal|oats)\b"),
]


def guess_category(item: dict) -> str:
    if item.get("category"):
        return str(item["category"])
    text = norm(" ".join(str(item.get(k) or "") for k in ("name", "brand", "size")))
    for cat, rx in CATEGORY_HINTS:
        if re.search(rx, text):
            return cat
    return "Other"


# ───────────────────────────── list data + page ─────────────────────────────

def normalize_list(data: dict) -> dict:
    """Validate and clean list data. Raises ValueError on bad input. Never invents prices or links."""
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ValueError("list data needs an 'items' array")
    items = []
    for raw in data["items"]:
        if not isinstance(raw, dict) or not str(raw.get("name") or "").strip():
            raise ValueError(f"every item needs a name: {raw!r}")
        it = dict(raw)
        it["name"] = str(it["name"]).strip()[:200]
        it["qty"] = clamp_qty(it.get("qty", 1))
        it["want"] = it.get("want") is not False
        h = to_halalas(it.get("price"))
        it["price"] = None if h is None else f"{h // 100}.{h % 100:02d}"
        for key in ("url", "amazonUrl"):
            if it.get(key):
                c = classify_url(it[key])
                if c["kind"] == "invalid":
                    raise ValueError(f"{it['name']}: bad {key} ({c['reason']}): {it[key]}")
        # A store link that is not a product page is kept but labelled honestly on the page.
        it["urlKind"] = classify_url(it["url"])["kind"] if it.get("url") else None
        if it.get("amazonUrl"):
            ac = classify_url(it["amazonUrl"])
            if ac["kind"] != "product":
                raise ValueError(f"{it['name']}: amazonUrl must be an exact Amazon product page, got {ac['kind']}")
            it["amazonUrl"] = ac["canonical"]
        if it["price"] is not None and not it.get("url") and not it.get("amazonUrl"):
            raise ValueError(f"{it['name']}: a price needs the product page it was read from")
        it["category"] = guess_category(it)
        items.append(it)
    out = {k: v for k, v in data.items() if k != "items"}
    out.setdefault("title", "Shopping list")
    out.setdefault("currency", "SAR")
    if out.get("amazonListUrl") and classify_url(out["amazonListUrl"])["kind"] != "list":
        raise ValueError("amazonListUrl must be a specific Amazon list link (/hz/wishlist/ls/<id>)")
    out["items"] = dedupe(items)
    return out


def embed_json(data: dict) -> str:
    """JSON safe to put inside <script>: every '<' becomes \\u003c (so '</script>' can't end the block)."""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


DATA_RE = re.compile(r'(<script type="application/json" id="list-data">)(.*?)(</script>)', re.S)


def build_page(data: dict, template: str | None = None) -> str:
    template = template if template is not None else TEMPLATE.read_text(encoding="utf-8")
    clean = normalize_list(data)
    if not DATA_RE.search(template):
        raise ValueError("template has no list-data block")
    return DATA_RE.sub(lambda m: m.group(1) + "\n" + embed_json(clean) + "\n" + m.group(3), template, count=1)


def read_page_data(html: str) -> dict:
    m = DATA_RE.search(html)
    if not m:
        raise ValueError("no list-data block in page")
    return json.loads(m.group(2))


def slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", norm(s))).strip("-") or "list"


def new_list_id() -> str:
    return secrets.token_urlsafe(9).replace("_", "x").replace("-", "y")
