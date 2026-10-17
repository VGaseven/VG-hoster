"""Amazon script, offline: page reading, item matching, and the no-purchase guards, run in a real browser against
saved pages shaped like amazon.sa (search results, product page, list page).

This proves the script's own logic. It cannot prove amazon.sa's live pages still look like this — that is the
"Amazon test (with you)" run on your laptop: python3 scripts/amazon_list.py create "Iced Matcha Latte" matcha.json
"""
import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import amazon_list as A  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None


def result(asin, title, price, sponsored=False):
    sp = '<span class="puis-sponsored-label-text">Sponsored</span>' if sponsored else ""
    return (f'<div data-component-type="s-search-result" data-asin="{asin}">{sp}<h2 aria-label="{title}"><a href="/dp/{asin}"><span>{title}</span></a></h2>'
            f'<span class="a-price"><span class="a-offscreen">SAR {price}</span></span></div>')


PRODUCTS = {
    "B0MATCHA30": ("Jade Leaf Organic Matcha Green Tea Powder - Culinary Grade (30g)", "89.00", "Jade Leaf", None, "In Stock"),
    "B0MATCH100": ("Jade Leaf Organic Matcha Green Tea Powder - Culinary Grade (100g)", "199.00", "Jade Leaf", None, "In Stock"),
    "B0SARY0400": ("Sary Natural Honey Squeeze Bottle", "24.95", "Sary", "400 Grams", "In Stock"),
    "B0SARY0250": ("Sary Natural Honey Squeeze 250g", "16.50", "Sary", None, "In Stock"),
    "B0FROTHER1": ("Milk Frother Handheld, Rechargeable Electric Whisk Foam Maker, Black", "45.00", "Zulay", None, "In Stock"),
    "B0MILKJUG1": ("Stainless Steel Milk Frothing Jug 600ml", "30.00", "Generic", None, "In Stock"),
    "B0ALMARAI1": ("Almarai Long Life Milk Full Fat 1 Litre x 4", "28.00", "Almarai", None, "Currently unavailable."),
}
SEARCH = {
    "matcha": [("B0MATCH100", True), ("B0MATCHA30", False)],
    "honey": [("B0SARY0250", False), ("B0SARY0400", False)],
    "frother": [("B0MILKJUG1", False), ("B0FROTHER1", False)],
    "almarai": [("B0ALMARAI1", False)],
}


def product_page(asin):
    title, price, brand, size, avail = PRODUCTS[asin]
    size_row = f"<tr><td>Size</td><td>{size}</td></tr>" if size else ""
    return f"""<html><head><link rel="canonical" href="https://www.amazon.sa/dp/{asin}"></head><body>
      <div id="nav-link-accountList-nav-line-1">Hello, Sam</div>
      <span id="productTitle"> {title} </span><a id="bylineInfo">Visit the {brand} Store</a>
      <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">SAR {price}</span></span></div>
      <div id="availability"><span>{avail}</span></div>
      <div id="productOverview_feature_div"><table><tr><td>Brand</td><td>{brand}</td></tr>{size_row}</table></div>
      <form id="addToCart" method="post" action="/cart/add-to-cart/ref=dp_start-bbf_1_glance">
        <input id="add-to-cart-button" type="submit" name="submit.add-to-cart" value="Add to Cart">
        <input id="buy-now-button" type="submit" name="submit.buy-now" value="Buy Now">
        <span id="wishListMainButton"><input id="add-to-wishlist-button-submit" name="submit.add-to-registry.wishlist" type="button" value="Add to List"></span>
        <a id="add-to-wishlist-button" href="javascript:void(0)" class="a-button-dropdown">Add to List ▾</a>
      </form></body></html>"""


def search_page(query):
    key = next((k for k in SEARCH if k in query.lower()), None)
    rows = "".join(result(a, PRODUCTS[a][0], PRODUCTS[a][1], sp) for a, sp in SEARCH.get(key, []))
    return f"<html><body><div class='s-main-slot'>{rows}</div></body></html>"


LIST_PAGE = """<html><body><ul id="g-items">
  <li data-id="X" data-itemid="I1" data-reposition-action-params='{"itemExternalId":"ASIN:B0MATCHA30|A2XXXX"}'><a id="itemName_I1" href="/dp/B0MATCHA30/?coliid=I1">Jade Leaf</a></li>
  <li data-id="X" data-itemid="I2"><a id="itemName_I2" href="/dp/B0SARY0400/?coliid=I2">Sary</a></li>
</ul><div id="endOfListMarker"></div></body></html>"""


def serve_fake_amazon(route):
    u = urlsplit(route.request.url)
    if u.path.startswith("/dp/"):
        asin = u.path.split("/")[2]
        return route.fulfill(body=product_page(asin), content_type="text/html; charset=utf-8") if asin in PRODUCTS else route.fulfill(status=404, body="")
    if u.path == "/s":
        return route.fulfill(body=search_page(parse_qs(u.query).get("k", [""])[0]), content_type="text/html; charset=utf-8")
    if u.path.startswith("/hz/wishlist/ls/"):
        return route.fulfill(body=LIST_PAGE, content_type="text/html; charset=utf-8")
    if A.FORBIDDEN_URL.search(route.request.url):
        raise AssertionError("purchase URL reached the network: " + route.request.url)
    return route.fulfill(body="<html><body>ok</body></html>", content_type="text/html; charset=utf-8")


@unittest.skipIf(sync_playwright is None, "playwright not installed")
class AmazonOffline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.ctx = self.browser.new_context()
        self.ctx.route("https://www.amazon.sa/**", serve_fake_amazon)
        A.install_guards(self.ctx)  # registered last = runs first, like in the real script
        self.page = self.ctx.new_page()

    def tearDown(self):
        self.ctx.close()

    def test_reads_search_product_and_list_pages(self):
        self.page.goto("https://www.amazon.sa/s?k=jade+leaf+matcha")
        res = self.page.evaluate(A.SEARCH_JS)
        self.assertEqual([(r["asin"], r["sponsored"]) for r in res], [("B0MATCH100", True), ("B0MATCHA30", False)])
        self.assertEqual(res[1]["price"], "SAR 89.00")
        prod = A.read_product(self.page, "B0SARY0400")
        self.assertEqual((prod["title"], prod["brand"], prod["size"]), ("Sary Natural Honey Squeeze Bottle", "Sary", "400 Grams"))
        self.assertEqual(A.listlib.to_halalas(prod["price"]), 2495)
        self.assertTrue(A.is_signed_in(self.page))
        self.page.goto("https://www.amazon.sa/hz/wishlist/ls/2ABCDEF1234XY")
        self.assertEqual(sorted(self.page.evaluate(A.LIST_ASINS_JS)), ["B0MATCHA30", "B0SARY0400"])

    def test_picks_matching_listing_or_explains(self):
        matcha = A.pick(self.page, {"name": "Jade Leaf Matcha Green Tea Powder", "brand": "Jade Leaf", "size": "30 g"})
        self.assertEqual((matcha["ok"], matcha["asin"]), (True, "B0MATCHA30"), "the 100 g sponsored result is skipped")
        honey = A.pick(self.page, {"name": "Sary Squeeze Honey", "brand": "Sary", "size": "400 g"})
        self.assertEqual((honey["ok"], honey["asin"]), (True, "B0SARY0400"), "size read from product details")
        frother = A.pick(self.page, {"name": "Handheld milk frother"})
        self.assertEqual((frother["ok"], frother["asin"]), (True, "B0FROTHER1"), "a milk jug is not a frother")
        milk = A.pick(self.page, {"name": "Almarai Full Fat Fresh Milk", "brand": "Almarai", "size": "2 L"})
        self.assertFalse(milk["ok"], "never swap in a different milk")
        self.assertIn("no listing with the right brand/size/variant", milk["reason"])
        none = A.pick(self.page, {"name": "Unobtainium widget"})
        self.assertFalse(none["ok"])

    def test_never_clicks_cart_or_buy(self):
        self.page.goto("https://www.amazon.sa/dp/B0MATCHA30")
        for sel in ("#add-to-cart-button", "#buy-now-button"):
            with self.assertRaises(A.SafetyError, msg=sel):
                A.safe_click(self.page.locator(sel))
        A.safe_click(self.page.locator("#add-to-wishlist-button"))  # Add to List is allowed

    def test_purchase_urls_blocked_even_if_submitted(self):
        self.page.goto("https://www.amazon.sa/dp/B0MATCHA30")
        blocked = []
        self.page.on("requestfailed", lambda r: blocked.append(r.url))
        self.page.evaluate("document.getElementById('addToCart').submit()")
        self.page.wait_for_timeout(500)
        self.assertTrue(any("/cart/add-to-cart" in u for u in blocked), blocked)
        self.assertNotIn("cart", self.page.url, "the cart page never loaded")

    def test_never_types_into_password_fields(self):
        self.page.set_content('<input id="pw" type="password"><input id="otp" name="otpCode"><input id="ln" name="listName">')
        for sel in ("#pw", "#otp"):
            with self.assertRaises(A.SafetyError):
                A.safe_fill(self.page.locator(sel), "secret")
        A.safe_fill(self.page.locator("#ln"), "Iced Matcha Latte")
        self.assertEqual(self.page.locator("#ln").input_value(), "Iced Matcha Latte")


if __name__ == "__main__":
    unittest.main()
