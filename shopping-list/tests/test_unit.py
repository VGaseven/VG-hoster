"""Unit tests: prices, totals, matching across categories, URL classification, page building, Amazon helpers.

Run: python3 -m unittest discover -s tests -v   (from the shopping-list folder)
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import listlib as L  # noqa: E402
import amazon_list as A  # noqa: E402


class Prices(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(L.to_halalas("43.50"), 4350)
        self.assertEqual(L.to_halalas("SAR 1,299.5"), 129950)
        self.assertEqual(L.to_halalas("SAR\xa089.00"), 8900)
        self.assertEqual(L.to_halalas("ر.س ١٢٫٩٥"), 1295, "Arabic digits and decimal separator")
        self.assertEqual(L.to_halalas("1.005"), 101, "half-up on the dropped digit")
        self.assertEqual(L.to_halalas("12"), 1200)
        self.assertEqual(L.to_halalas(7), 700)
        self.assertEqual(L.to_halalas("0.1") + L.to_halalas("0.2"), 30, "no float drift")
        for bad in (None, "", "abc", "Price not checked", True):
            self.assertIsNone(L.to_halalas(bad))

    def test_format(self):
        self.assertEqual(L.format_halalas(129950), "SAR 1,299.50")
        self.assertEqual(L.format_halalas(5), "SAR 0.05")


class Totals(unittest.TestCase):
    ITEMS = [
        {"name": "Matcha", "price": "89.00", "qty": 1},
        {"name": "Honey", "price": "24.95", "qty": 2},
        {"name": "Frother", "price": "45.00", "qty": 1, "want": False},
        {"name": "Milk", "price": None, "qty": 3},
    ]

    def test_ticked_only_with_quantities(self):
        t = L.totals(self.ITEMS)
        self.assertEqual(t["total"], 8900 + 2 * 2495)
        self.assertEqual(t["ticked"], 3)
        self.assertEqual(t["unpriced"], 1)
        self.assertFalse(t["complete"], "unpriced ticked item -> incomplete")

    def test_untick_unpriced_makes_complete(self):
        items = [dict(i) for i in self.ITEMS]
        items[3]["want"] = False
        items[2]["want"] = True
        t = L.totals(items)
        self.assertEqual(t["total"], 8900 + 4990 + 4500)
        self.assertTrue(t["complete"])

    def test_qty_clamped(self):
        self.assertEqual(L.totals([{"name": "x", "price": "1", "qty": 500}])["total"], 9900)
        self.assertEqual(L.totals([{"name": "x", "price": "1", "qty": 0}])["total"], 100)


class Matching(unittest.TestCase):
    def m(self, r, l):
        return L.match_product(r, l)["status"]

    def test_ported_haircare_cases(self):
        alp = {"brand": "Alpecin", "name": "Alpecin Hybrid Sensitive Shampoo", "size": "250 ml"}
        self.assertEqual(self.m(alp, {"name": "Alpecin Hybrid Caffeine Shampoo 2 x 250 ml sensitive"}), "similar")
        self.assertEqual(self.m(alp, {"name": "Alpecin Hybrid Caffeine Shampoo sensitive 300g"}), "similar")
        self.assertEqual(self.m(alp, {"brand": "Plantur", "name": "Plantur 39 Caffeine Shampoo 250 ml"}), "similar")
        self.assertEqual(self.m(alp, {"name": "Alpecin Hybrid Sensitive Shampoo 250 ml", "availability": "out_of_stock"}), "unavailable")
        self.assertEqual(self.m(alp, None), "unverified")
        self.assertEqual(self.m(alp, {"name": "Alpecin Hybrid Sensitive Shampoo"}), "unverified")
        gio = {"brand": "Giovanni", "name": "Direct Leave-In Weightless Moisture", "size": "250 ml"}
        self.assertEqual(self.m(gio, {"brand": "Giovanni", "name": "Direct Leave-In Weightless Hydration Conditioner 250 ml"}), "equivalent")

    def test_groceries(self):
        milk = {"brand": "Almarai", "name": "Almarai Full Fat Fresh Milk", "size": "2 L"}
        self.assertEqual(self.m(milk, {"name": "Almarai Fresh Milk Full Fat 2 L"}), "exact")
        self.assertEqual(self.m(milk, {"name": "Almarai Fresh Milk Full Fat 1 L"}), "similar")
        self.assertEqual(self.m(milk, {"name": "Almarai Fresh Milk Low Fat 2 L"}), "similar", "fat level is a variant")
        matcha = {"brand": "Jade Leaf", "name": "Jade Leaf Matcha Green Tea Powder", "size": "30 g"}
        self.assertEqual(self.m(matcha, {"name": "Jade Leaf Organic Matcha Green Tea Powder, Culinary Grade, 30g (1.06 oz)"}), "exact")
        self.assertEqual(self.m(matcha, {"name": "Jade Leaf Matcha Green Tea Powder 100g"}), "similar")
        honey = {"brand": "Sary", "name": "Sary Squeeze Honey", "size": "400 g"}
        self.assertEqual(self.m(honey, {"name": "Sary Honey Squeeze Bottle 400g"}), "exact")
        self.assertEqual(self.m(honey, {"name": "Sary Honey Squeeze Bottle 250g"}), "similar")
        self.assertEqual(self.m({"brand": "Nescafe", "name": "Nescafe Gold decaf 200g"}, {"name": "Nescafe Gold Instant Coffee 200g"}), "similar")

    def test_electronics(self):
        sony = {"brand": "Sony", "name": "Sony WH-1000XM5 wireless headphones black"}
        self.assertEqual(self.m(sony, {"name": "Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black"}), "exact")
        self.assertEqual(self.m(sony, {"name": "Sony WH-1000XM4 Wireless Headphones, Black"}), "similar", "model number")
        self.assertEqual(self.m(sony, {"name": "Sony WH-1000XM5 Wireless Headphones, Silver"}), "similar", "colour")
        ip = {"brand": "Apple", "name": "iPhone 16 Pro 256GB Natural Titanium"}
        self.assertEqual(self.m(ip, {"name": "Apple iPhone 16 Pro 512GB Natural Titanium"}), "similar", "storage")
        self.assertEqual(self.m(ip, {"name": "Apple iPhone 16 Pro (256 GB) - Natural Titanium"}), "exact")
        self.assertEqual(self.m({"brand": "Apple", "name": "iPhone 16 Pro 256GB"}, {"name": "Apple iPhone 16 Pro Natural Titanium"}), "unverified")
        self.assertEqual(self.m({"brand": "LG", "name": "LG UltraGear 27 inch monitor 27GR75Q"}, {"name": "LG 27GR75Q UltraGear 27 Inch QHD IPS Gaming Monitor"}), "exact")

    def test_fashion(self):
        tee = {"brand": "Nike", "name": "Nike Dri-FIT T-Shirt black size M"}
        self.assertEqual(self.m(tee, {"name": "Nike Men's Dri-FIT T-Shirt, Black, Size M"}), "exact")
        self.assertEqual(self.m(tee, {"name": "Nike Men's Dri-FIT T-Shirt, Black, Size L"}), "similar", "clothing size")
        self.assertEqual(self.m(tee, {"name": "Nike Men's Dri-FIT T-Shirt, White, Size M"}), "similar", "colour")
        self.assertEqual(self.m(tee, {"name": "Nike Men's Dri-FIT T-Shirt, Black"}), "unverified", "size not shown")

    def test_beauty_and_baby(self):
        cer = {"brand": "CeraVe", "name": "CeraVe Moisturizing Cream", "size": "454 g"}
        self.assertEqual(self.m(cer, {"name": "CeraVe Moisturising Cream 454g"}), "equivalent", "UK/US spelling")
        self.assertEqual(self.m(cer, {"name": "CeraVe Moisturizing Cream 340g"}), "similar")
        self.assertEqual(self.m({"brand": "La Roche-Posay", "name": "Anthelios SPF 50 sunscreen", "size": "50 ml"},
                                {"name": "La Roche-Posay Anthelios SPF 30 sunscreen 50ml"}), "similar", "formula (SPF)")
        pamp = {"brand": "Pampers", "name": "Pampers Baby-Dry size 4 diapers 64 count"}
        self.assertEqual(self.m(pamp, {"name": "Pampers Baby-Dry Diapers, Size 4, 64 Count"}), "exact")
        self.assertEqual(self.m(pamp, {"name": "Pampers Baby-Dry Diapers Size 4, 52 Count"}), "similar")
        self.assertEqual(self.m(pamp, {"name": "Pampers Baby-Dry Diapers, Size 5, 64 Count"}), "similar")

    def test_home(self):
        self.assertEqual(self.m({"brand": "IKEA", "name": "IKEA MARKUS office chair"}, {"name": "MARKUS Office chair, Vissle dark grey"}), "exact")

    def test_dedupe(self):
        items = [{"brand": "Sary", "name": "Sary Squeeze Honey", "size": "400 g", "qty": 1},
                 {"brand": "Sary", "name": "Sary squeeze honey", "size": "400g", "qty": 2, "price": "24.95"},
                 {"brand": "Sary", "name": "Sary Squeeze Honey", "size": "250 g"}]
        out = L.dedupe(items)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["qty"], 2)
        self.assertEqual(out[0]["price"], "24.95")

    def test_categories(self):
        self.assertEqual(L.guess_category({"name": "Almarai Full Fat Milk"}), "Groceries")
        self.assertEqual(L.guess_category({"name": "Handheld milk frother"}), "Electronics")
        self.assertEqual(L.guess_category({"name": "Pampers diapers size 4"}), "Baby")
        self.assertEqual(L.guess_category({"name": "Nike T-Shirt"}), "Fashion")
        self.assertEqual(L.guess_category({"name": "x", "category": "Gifts"}), "Gifts")


class Urls(unittest.TestCase):
    def k(self, u):
        return L.classify_url(u)["kind"]

    def test_amazon(self):
        c = L.classify_url("https://www.amazon.sa/-/en/Jade-Leaf-Matcha/dp/B00PFDH0IC?ref=sr_1_1&tag=x-21&th=1")
        self.assertEqual((c["kind"], c["id"], c["canonical"]), ("product", "B00PFDH0IC", "https://www.amazon.sa/dp/B00PFDH0IC"))
        self.assertEqual(self.k("https://www.amazon.sa/gp/product/B00PFDH0IC"), "product")
        self.assertEqual(self.k("https://www.amazon.sa/s?k=matcha"), "search")
        self.assertEqual(self.k("https://www.amazon.sa/-/en/matcha/s?k=matcha"), "search")
        self.assertEqual(self.k("https://www.amazon.sa/hz/wishlist/ls/2ABCDEF1234XY?ref_=wl_share"), "list")
        self.assertEqual(self.k("https://www.amazon.sa/hz/wishlist/ls"), "list_dashboard")
        self.assertEqual(self.k("https://www.amazon.sa/hz/wishlist/intro"), "list_dashboard")
        self.assertEqual(self.k("https://www.amazon.sa/"), "homepage")
        self.assertEqual(self.k("https://www.amazon.sa/-/en/"), "homepage")
        self.assertEqual(self.k("https://www.amazon.sa/b?node=12345"), "category")

    def test_other_stores(self):
        self.assertEqual(self.k("https://www.noon.com/saudi-en/sary-honey/N12345678A/p/"), "product")
        self.assertEqual(self.k("https://www.noon.com/saudi-en/search/?q=honey"), "search")
        self.assertEqual(self.k("https://sa.iherb.com/pr/jade-leaf-matcha/70261"), "product")
        self.assertEqual(self.k("https://sa.iherb.com/search?kw=matcha"), "search")
        self.assertEqual(self.k("https://www.nahdionline.com/en-sa/x/pdp/102506037"), "product")
        self.assertEqual(self.k("https://www.carrefourksa.com/mafsau/en/fresh-milk/almarai-full-fat-2l/p/106475"), "product")
        self.assertEqual(self.k("https://www.carrefourksa.com/mafsau/en/search?keyword=milk&text=milk"), "search")
        self.assertEqual(self.k("https://www.jarir.com/sa-en/apple-iphone-16-pro-256gb-612345.html"), "product")
        self.assertEqual(self.k("https://www.ikea.com/sa/en/p/markus-office-chair-70261150/"), "product")
        self.assertEqual(self.k("https://www.ikea.com/sa/en/cat/chairs-fu002/"), "other")

    def test_unsafe(self):
        for u in ("http://www.amazon.sa/dp/B00PFDH0IC", "javascript:alert(1)", "https://127.0.0.1/x", "https://192.168.1.10/",
                  "https://user:pw@amazon.sa/dp/B00PFDH0IC", "not a url", "", None):
            self.assertEqual(self.k(u), "invalid", u)


class Page(unittest.TestCase):
    def test_build_escapes_and_validates(self):
        data = {"title": "Test </script><b>x</b>", "items": [{"name": "A <i>", "price": "1.5", "url": "https://www.panda.sa/en/p/a/1"}]}
        html = L.build_page(data)
        block = L.DATA_RE.search(html).group(2)
        self.assertNotIn("<", block, "every < inside the JSON must be \\u003c")
        self.assertIn("\\u003c/script>", block)
        back = L.read_page_data(html)
        self.assertEqual(back["title"], "Test </script><b>x</b>")
        self.assertEqual(back["items"][0]["price"], "1.50")
        self.assertEqual(back["items"][0]["urlKind"], "product")

    def test_rejects_bad_links(self):
        with self.assertRaises(ValueError):
            L.build_page({"items": [{"name": "x", "amazonUrl": "https://www.amazon.sa/s?k=x"}]})  # search as product
        with self.assertRaises(ValueError):
            L.build_page({"items": [{"name": "x", "url": "http://insecure.example/p/1"}]})
        with self.assertRaises(ValueError):
            L.build_page({"items": [{"name": "x", "price": "5"}]})  # price with no page it came from
        with self.assertRaises(ValueError):
            L.build_page({"amazonListUrl": "https://www.amazon.sa/hz/wishlist/ls", "items": [{"name": "x"}]})

    def test_template_has_bom_and_copy(self):
        t = L.TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("'\\uFEFF' +", t, "CSV starts with the BOM")
        self.assertIn("inClaudeArtifact", t)
        self.assertIn("execCommand('copy')", t, "copy fallback when the clipboard API is blocked")


class Docs(unittest.TestCase):
    def test_skill_md_escape_instruction_kept_its_backslash(self):
        md = (L.SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("as `" + chr(92) + "u003c`", md)
        self.assertLess(len(md.splitlines()), 300)
        self.assertNotIn(chr(0xFEFF), L.TEMPLATE.read_text(encoding="utf-8"), "BOM must be the \\uFEFF escape, not a raw char")


class AmazonHelpers(unittest.TestCase):
    def test_relevance(self):
        fr = {"name": "Handheld milk frother"}
        self.assertTrue(A.relevant(fr, "Milk Frother Handheld, Electric Whisk Foam Maker, Black"))
        self.assertFalse(A.relevant(fr, "Stainless Steel Milk Jug 600ml"))
        self.assertTrue(A.relevant({"name": "Almarai Full Fat Fresh Milk 2L", "brand": "Almarai"}, "Almarai Fresh Milk Full Fat 2 Liter"))

    def test_rank_drops_mismatches(self):
        item = {"brand": "Jade Leaf", "name": "Jade Leaf Matcha Green Tea Powder", "size": "30 g"}
        results = [
            {"asin": "B000000001", "title": "Jade Leaf Matcha Green Tea Powder 100g", "pos": 0, "sponsored": False},
            {"asin": "B000000002", "title": "Matcha Whisk Set Bamboo", "pos": 1, "sponsored": False},
            {"asin": "B000000003", "title": "Jade Leaf Matcha Green Tea Powder - Culinary Grade (30g)", "pos": 2, "sponsored": True},
            {"asin": "B000000004", "title": "Jade Leaf Matcha Green Tea Powder - Culinary Grade (30g)", "pos": 3, "sponsored": False},
            {"asin": "B000000005", "title": "Jade Leaf Matcha Green Tea Powder", "pos": 4, "sponsored": False},
        ]
        self.assertEqual([r["asin"] for r in A.rank_candidates(item, results)], ["B000000004", "B000000003", "B000000005"])

    def test_judge_product(self):
        item = {"brand": "Sary", "name": "Sary Squeeze Honey", "size": "400 g"}
        ok = A.judge_product(item, {"title": "Sary Natural Honey Squeeze 400g", "brand": "Sary", "availability": "In Stock"})
        self.assertTrue(ok["ok"])
        size_from_details = A.judge_product(item, {"title": "Sary Natural Honey Squeeze Bottle", "brand": "Sary", "size": "400 Grams"})
        self.assertTrue(size_from_details["ok"], size_from_details)
        wrong = A.judge_product(item, {"title": "Sary Natural Honey Squeeze 250g", "brand": "Sary"})
        self.assertFalse(wrong["ok"])
        self.assertIn("Different size", wrong["reason"])
        gone = A.judge_product(item, {"title": "Sary Natural Honey Squeeze 400g", "brand": "Sary", "availability": "Currently unavailable."})
        self.assertFalse(gone["ok"])

    def test_guard_patterns(self):
        for t in ("Add to Cart", "add-to-cart-button", "Buy Now", "Proceed to checkout", "أضف إلى عربة التسوق", "اشتر الآن"):
            self.assertTrue(A.FORBIDDEN_TEXT.search(t) or A.FORBIDDEN_ID.search(t), t)
        for t in ("Add to List", "Create a List", "Send list to others", "View only", "Copy link"):
            self.assertFalse(A.FORBIDDEN_TEXT.search(t) or A.FORBIDDEN_ID.search(t), t)
        self.assertTrue(A.FORBIDDEN_URL.search("https://www.amazon.sa/gp/buy/spc/handlers/display.html"))
        self.assertTrue(A.FORBIDDEN_URL.search("https://www.amazon.sa/cart/add-to-cart/ref=x"))
        self.assertFalse(A.FORBIDDEN_URL.search("https://www.amazon.sa/hz/wishlist/ls/2ABCDEF1234XY"))
        self.assertFalse(A.FORBIDDEN_URL.search("https://www.amazon.sa/ap/signin?openid=x"))


class ChatGPTPack(unittest.TestCase):
    ROOT = L.SKILL_DIR.parent / "chatgpt"

    def test_instructions_size_and_escape(self):
        text = (self.ROOT / "GPT-INSTRUCTIONS.md").read_text(encoding="utf-8")
        self.assertLess(len(text), 8000)
        self.assertIn('.replace("<", "' + chr(92) * 2 + 'u003c")', text)

    def test_template_identical_and_gpt_method_works(self):
        tpl = (self.ROOT / "list-template.html").read_text(encoding="utf-8")
        self.assertEqual(tpl, L.TEMPLATE.read_text(encoding="utf-8"))
        # What the instructions tell ChatGPT's Python to do:
        data = {"title": "A <b>", "currency": "SAR", "items": [{"name": "x</script>", "price": None, "want": True}]}
        payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
        start = tpl.index('<script type="application/json" id="list-data">') + len('<script type="application/json" id="list-data">')
        end = tpl.index("</script>", start)
        page = tpl[:start] + payload + tpl[end:]
        self.assertEqual(L.read_page_data(page), data)


if __name__ == "__main__":
    unittest.main()
