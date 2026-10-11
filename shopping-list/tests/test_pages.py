"""Pages test: publish a list, open it signed-out, update it, check the URL stays the same and nothing is duplicated.

GitHub is replaced by a local bare git repo whose post-receive hook "deploys" the pushed branch to a folder served
over HTTP — the same push → deploy → fetch flow publish_pages.py uses with GitHub Pages. The real GitHub run
(gh + github.io) is done on your laptop: python3 scripts/publish_pages.py <list.json>
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
sys.path.insert(0, str(HERE))
import listlib as L  # noqa: E402
from test_browser import Server, sync_playwright  # noqa: E402


def sh(*cmd, cwd=None):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True)


class PagesFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.bare, self.site = t / "cartflow-lists.git", t / "site"
        self.site.mkdir()
        sh("git", "init", "--bare", "-b", "main", str(self.bare))
        hook = self.bare / "hooks" / "post-receive"
        hook.write_text(f"#!/bin/sh\ngit --work-tree={self.site} --git-dir={self.bare} checkout -f main\n")
        hook.chmod(0o755)
        self.server = Server(self.site)
        os.environ["SHOPPING_LIST_CACHE"] = str(t / "cache")
        import publish_pages
        self.pp = publish_pages
        self.pp.CACHE = t / "cache"
        self.list_path = t / "list.json"

    def tearDown(self):
        self.server.close()
        self.tmp.cleanup()

    def publish(self, data, *extra):
        self.list_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        out = io.StringIO()
        with redirect_stdout(out):
            code = self.pp.main([str(self.list_path), "--remote", str(self.bare), "--base-url", self.server.url,
                                 "--workdir", str(Path(self.tmp.name) / "work"), "--timeout", "20", *extra])
        self.assertEqual(code, 0, out.getvalue())
        return json.loads(out.getvalue().strip().splitlines()[-1])

    def live_names(self, url):
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context()  # signed-out: no cookies at all
            page = ctx.new_page()
            page.goto(url)
            names = page.locator("#items li .name").all_inner_texts()
            total = page.locator("#total").inner_text()
            b.close()
        return names, total

    def test_publish_update_same_url_no_duplicates(self):
        v1 = {"title": "Pages Test", "items": [
            {"name": "Jade Leaf Matcha Green Tea Powder", "brand": "Jade Leaf", "size": "30 g", "price": "89.00", "url": "https://www.amazon.sa/dp/B00PFDH0IC"},
            {"name": "Sary Squeeze Honey", "brand": "Sary", "size": "400 g", "price": None}]}
        r1 = self.publish(v1, "--browser-check")
        self.assertTrue(r1["verified_signed_out"])
        self.assertRegex(r1["url"], r"/l/[A-Za-z0-9_-]{6,40}/$")
        names, total = self.live_names(r1["url"])
        self.assertEqual(names, ["Jade Leaf Matcha Green Tea Powder", "Sary Squeeze Honey"])
        self.assertEqual(total, "SAR 89.00")
        saved = json.loads(self.list_path.read_text())
        self.assertEqual(saved["pagesUrl"], r1["url"], "id/URL saved back into list.json for next time")

        # Update: change qty, repeat an item (different spelling) and add one -> same URL, no duplicates.
        v2 = dict(saved)
        v2["items"] = [dict(v1["items"][0], qty=2), v1["items"][1],
                       {"name": "Sary squeeze honey", "brand": "Sary", "size": "400g", "price": "24.95", "url": "https://www.panda.sa/en/p/sary/123456"},
                       {"name": "Handheld milk frother", "price": "45.00", "url": "https://www.noon.com/saudi-en/frother/N12345678A/p/"}]
        r2 = self.publish(v2)
        self.assertEqual(r2["url"], r1["url"], "same URL after update")
        names, total = self.live_names(r2["url"])
        self.assertEqual(names, ["Jade Leaf Matcha Green Tea Powder", "Sary Squeeze Honey", "Handheld milk frother"])
        self.assertEqual(total, "SAR 247.95")  # 2x89 + 24.95 + 45

        # --add merges into the live list without duplicating what's already there.
        r3 = self.publish({"title": "Pages Test", "pagesId": r1["id"], "items": [
            {"name": "Handheld Milk Frother", "price": "45.00", "url": "https://www.noon.com/saudi-en/frother/N12345678A/p/"},
            {"name": "Vanilla syrup", "price": None}]}, "--add")
        self.assertEqual(r3["url"], r1["url"])
        names, _ = self.live_names(r3["url"])
        self.assertEqual(len(names), 4, names)
        self.assertEqual(sum(n.lower() == "handheld milk frother" for n in names), 1)

        # One page per list in the repo, nothing else listed publicly.
        files = subprocess.run(["git", "--git-dir", str(self.bare), "ls-tree", "-r", "--name-only", "main"], capture_output=True, text=True).stdout.split()
        self.assertEqual(sorted(files), sorted([".nojekyll", "index.html", f"l/{r1['id']}/index.html"]))

    def test_second_list_gets_its_own_url(self):
        a = self.publish({"title": "List A", "items": [{"name": "Milk"}]})
        b = self.publish({"title": "List B", "items": [{"name": "Eggs"}]})
        self.assertNotEqual(a["url"], b["url"])
        self.assertEqual(self.live_names(a["url"])[0], ["Milk"])

    def test_check_page_catches_problems(self):
        exp = L.normalize_list({"title": "T", "items": [{"name": "A"}, {"name": "B"}]})
        page = L.build_page({"title": "T", "items": [{"name": "A"}]})
        self.assertIn("missing on live page: B", self.pp.check_page(page, exp))
        self.assertEqual(self.pp.check_page(L.build_page({"title": "T", "items": [{"name": "A"}, {"name": "B"}]}), exp), [])
        self.assertTrue(self.pp.check_page("<html>404</html>", exp))


if __name__ == "__main__":
    unittest.main()
