"""Browser test: a generated list opened in a fresh browser context with no cookies.

Ticks/unticks, quantities, totals, Copy (clipboard and fallback), CSV with BOM, exact product links,
CSV hidden inside a claude.ai artifact, category groups, XSS safety, phone width.
Needs: pip install playwright (Chromium). Run: python3 -m unittest tests.test_browser -v
"""
import csv
import io
import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import listlib as L  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

PANDA = "https://www.panda.sa/en/p/sary-squeeze-honey-400g/123456"
AMZ_MATCHA = "https://www.amazon.sa/dp/B00PFDH0IC"
LIST = {
    "title": "Iced Matcha Latte · لاتيه",
    "currency": "SAR",
    "checked": "11 Oct 2026",
    "items": [
        {"name": "Jade Leaf Matcha Green Tea Powder", "brand": "Jade Leaf", "size": "30 g", "qty": 1, "store": "Amazon.sa",
         "url": AMZ_MATCHA, "price": "89.00", "amazonUrl": AMZ_MATCHA, "category": "Groceries"},
        {"name": "عسل صري سهل الضغط Sary Squeeze Honey", "brand": "Sary", "size": "400 g", "qty": 2, "store": "Panda",
         "url": PANDA, "price": "24.95", "category": "Groceries"},
        {"name": "Almarai Full Fat Fresh Milk", "brand": "Almarai", "size": "2 L", "qty": 1, "price": None,
         "store": "Carrefour KSA", "url": "https://www.carrefourksa.com/mafsau/en/search?text=almarai%20milk%202l",
         "note": "Not sold on Amazon.sa", "category": "Groceries"},
        {"name": "Handheld milk frother <img src=x onerror=window.__xss=1>", "qty": 1, "price": "45.00", "want": False,
         "store": "noon", "url": "https://www.noon.com/saudi-en/frother/N12345678A/p/", "category": "Kitchen tools"},
    ],
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Server:
    def __init__(self, root):
        handler = partial(QuietHandler, directory=str(root))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


@unittest.skipIf(sync_playwright is None, "playwright not installed")
class BrowserList(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.html = L.build_page(LIST)
        Path(cls.tmp.name, "list.html").write_text(cls.html, encoding="utf-8")
        cls.server = Server(cls.tmp.name)
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.close()
        cls.tmp.cleanup()

    def fresh(self, **kw):
        ctx = self.browser.new_context(accept_downloads=True, **kw)  # new context = no cookies, no storage
        self.assertEqual(ctx.cookies(), [])
        # Store sites are not reachable from tests: answer them with a stub page so we can see which URL was opened.
        ctx.route("https://www.panda.sa/**", lambda r: r.fulfill(body="<title>Panda product</title>", content_type="text/html"))
        ctx.route("https://www.amazon.sa/**", lambda r: r.fulfill(body="<title>Amazon</title>", content_type="text/html"))
        return ctx

    def total(self, page):
        return page.locator("#total").inner_text()

    def test_ticks_quantities_totals(self):
        ctx = self.fresh()
        page = ctx.new_page()
        page.goto(self.server.url + "/list.html")
        self.assertEqual(page.locator("#items li").count(), 4)
        self.assertFalse(page.locator("#amazon-list").is_visible(), "no Amazon list banner without amazonListUrl")
        matcha_links = page.locator("#items li").nth(0).locator("a").all_inner_texts()
        self.assertEqual(matcha_links, ["Amazon.sa ↗"], "store link = Amazon product -> shown once")
        self.assertEqual(page.locator("#items h2").all_inner_texts(), ["GROCERIES", "KITCHEN TOOLS"], "grouped by category")
        # ticked: matcha 89.00 + honey 2 x 24.95; milk ticked but unpriced; frother unticked
        self.assertEqual(self.total(page), "SAR 138.90")
        self.assertIn("Incomplete: 1 ticked item has no checked price", page.locator("#caveat").inner_text())
        self.assertEqual(page.locator("#items li").nth(2).locator(".price").inner_text(), "Price not checked")
        boxes = page.locator("#items input[type=checkbox]")
        boxes.nth(3).check()  # tick frother
        self.assertEqual(self.total(page), "SAR 183.90")
        boxes.nth(2).uncheck()  # untick unpriced milk -> complete
        self.assertEqual(page.locator("#caveat").inner_text(), "")
        self.assertEqual(page.locator("#label").inner_text(), "Total of ticked items")
        honey = page.locator("#items li").nth(1)
        honey.get_by_role("button", name="More").click()
        self.assertEqual(honey.locator("output").inner_text(), "3")
        self.assertEqual(self.total(page), "SAR 208.85")
        self.assertIn("SAR 24.95 each", honey.inner_text())
        honey = page.locator("#items li").nth(1)
        for _ in range(5):
            honey = page.locator("#items li").nth(1)
            if honey.get_by_role("button", name="Less").is_enabled():
                honey.get_by_role("button", name="Less").click()
        self.assertEqual(page.locator("#items li").nth(1).locator("output").inner_text(), "1", "quantity never below 1")
        self.assertEqual(self.total(page), "SAR 158.95")
        boxes = page.locator("#items input[type=checkbox]")
        boxes.nth(0).uncheck()
        self.assertEqual(self.total(page), "SAR 69.95")
        self.assertIsNone(page.evaluate("window.__xss"), "item names are escaped")
        ctx.close()

    def test_copy_clipboard_and_fallback(self):
        ctx = self.fresh(permissions=["clipboard-read", "clipboard-write"])
        page = ctx.new_page()
        page.goto(self.server.url + "/list.html")
        page.click("#copy")
        page.wait_for_function("window.__copied")
        text = page.evaluate("navigator.clipboard.readText()")
        self.assertIn("1 × Jade Leaf Matcha Green Tea Powder (30 g) — SAR 89.00", text)
        self.assertIn("2 × عسل صري", text)
        self.assertIn(AMZ_MATCHA, text)
        self.assertNotIn("frother", text, "unticked items are not copied")
        self.assertIn("Total: SAR 138.90 (incomplete: 1 without a checked price)", text)
        ctx.close()
        # Clipboard API unavailable (e.g. sandboxed iframe): text is selected in a box and execCommand copy is tried.
        ctx = self.fresh()
        ctx.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
        page = ctx.new_page()
        page.goto(self.server.url + "/list.html")
        page.click("#copy")
        box = page.locator(".dock textarea")
        self.assertTrue(box.is_visible())
        self.assertIn("Jade Leaf", box.input_value())
        self.assertIn(page.locator("#toast").inner_text(), ("List copied", "Select and copy the text below"))
        ctx.close()

    def test_links_open_exact_product(self):
        ctx = self.fresh()
        page = ctx.new_page()
        page.goto(self.server.url + "/list.html")
        honey = page.locator("#items li").nth(1)
        link = honey.locator("a[data-link=store]")
        self.assertEqual(link.get_attribute("href"), PANDA)
        self.assertEqual(link.inner_text(), "Panda ↗")
        with page.expect_popup() as pop:
            link.click()
        self.assertEqual(pop.value.url, PANDA, "opens the exact product page")
        pop.value.close()
        matcha_amz = page.locator("#items li").nth(0).locator("a[data-link=amazon]")
        self.assertEqual((matcha_amz.inner_text(), matcha_amz.get_attribute("href")), ("Amazon.sa ↗", AMZ_MATCHA))
        with page.expect_popup() as pop:
            matcha_amz.click()
        self.assertEqual(pop.value.url, AMZ_MATCHA)
        # A search link is never presented as a product: it is labelled "Search …"
        milk = page.locator("#items li").nth(2)
        self.assertEqual(milk.locator("a[data-link=store]").inner_text(), "Search Carrefour KSA ↗")
        self.assertEqual(milk.locator("a[data-link=amazon]").inner_text(), "Search Amazon.sa ↗")
        self.assertTrue(milk.locator("a[data-link=amazon]").get_attribute("href").startswith("https://www.amazon.sa/s?k="))
        ctx.close()

    def test_csv_has_bom_and_ticked_rows(self):
        ctx = self.fresh()
        page = ctx.new_page()
        page.goto(self.server.url + "/list.html")
        self.assertTrue(page.locator("#csv").is_visible())
        with page.expect_download() as dl:
            page.click("#csv")
        raw = Path(dl.value.path()).read_bytes()
        self.assertEqual(raw[:3], b"\xef\xbb\xbf", "CSV starts with the UTF-8 BOM")
        rows = list(csv.reader(io.StringIO(raw[3:].decode("utf-8"))))
        self.assertEqual(rows[0][:4], ["Item", "Size", "Qty", "Price each"])
        self.assertEqual(len(rows), 4, "header + 3 ticked items")
        self.assertTrue(rows[2][0].startswith("عسل صري"), "Arabic intact")
        self.assertEqual(rows[3][3], "not checked")
        ctx.close()

    def test_inside_claude_artifact_hides_csv_keeps_copy(self):
        ctx = self.fresh()
        url = "https://abc123.claudeusercontent.com/list.html"
        ctx.route(url, lambda r: r.fulfill(body=self.html, content_type="text/html; charset=utf-8"))
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin="https://abc123.claudeusercontent.com")
        page = ctx.new_page()
        page.goto(url)
        self.assertFalse(page.locator("#csv").is_visible(), "Download CSV hidden in a claude.ai artifact")
        self.assertTrue(page.locator("#copy").is_visible())
        page.click("#copy")
        page.wait_for_function("window.__copied")
        self.assertIn("Jade Leaf", page.evaluate("navigator.clipboard.readText()"))
        ctx.close()

    def test_phone_width_no_horizontal_scroll(self):
        ctx = self.fresh(viewport={"width": 375, "height": 740})
        page = ctx.new_page()
        page.goto(self.server.url + "/list.html")
        self.assertLessEqual(page.evaluate("document.documentElement.scrollWidth"), 375)
        page.screenshot(path=str(Path(self.tmp.name, "phone.png")), full_page=True)
        ctx.close()

    def test_amazon_list_banner(self):
        data = dict(LIST, amazonListUrl="https://www.amazon.sa/hz/wishlist/ls/2ABCDEF1234XY")
        Path(self.tmp.name, "with-amazon.html").write_text(L.build_page(data), encoding="utf-8")
        ctx = self.fresh()
        page = ctx.new_page()
        page.goto(self.server.url + "/with-amazon.html")
        a = page.locator("#amazon-list")
        self.assertTrue(a.is_visible())
        self.assertEqual(a.get_attribute("href"), "https://www.amazon.sa/hz/wishlist/ls/2ABCDEF1234XY")
        ctx.close()


if __name__ == "__main__":
    unittest.main()
