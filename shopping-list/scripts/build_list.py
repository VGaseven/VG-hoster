#!/usr/bin/env python3
"""Build the no-login list page from list JSON.

  python3 scripts/build_list.py list.json -o iced-matcha-latte-list.html

Validates the data (https links, Amazon links must be exact product pages, prices only with the page they came from),
removes duplicate items, escapes '<' as \\u003c, and prints a one-line summary with the total of ticked items.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import listlib  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("list_json")
    ap.add_argument("-o", "--out", help="output .html (default: <title-slug>-list.html)")
    args = ap.parse_args(argv)
    data = json.loads(Path(args.list_json).read_text(encoding="utf-8"))
    try:
        html = listlib.build_page(data)
    except ValueError as e:
        print("ERROR:", e, file=sys.stderr)
        return 2
    clean = listlib.read_page_data(html)
    out = Path(args.out or f"{listlib.slug(clean['title'])}-list.html")
    out.write_text(html, encoding="utf-8")
    t = listlib.totals(clean["items"])
    msg = f"{out}: {len(clean['items'])} items, ticked total {listlib.format_halalas(t['total'], clean['currency'])}"
    if not t["complete"]:
        msg += f" (incomplete: {t['unpriced']} ticked without a checked price)"
    print(msg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
