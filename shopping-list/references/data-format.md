# list.json

```json
{
  "title": "Iced Matcha Latte",          // also the Amazon list name and file name
  "currency": "SAR",
  "checked": "11 Oct 2026",              // date prices were read
  "amazonListUrl": null,                 // set by amazon_list.py --update-list (verified view-only link)
  "pagesId": null, "pagesUrl": null,     // set by publish_pages.py
  "items": [{
    "name": "Jade Leaf Matcha Green Tea Powder",  // required
    "brand": "Jade Leaf", "size": "30 g", "variant": "culinary",
    "qty": 1,                            // 1–99
    "store": "Amazon.sa",
    "url": "https://www.amazon.sa/dp/B0CRB3DCZ6", // exact product page (search pages get labelled "Search …")
    "price": "125.00",                   // decimal string read on that page now, else null
    "amazonUrl": "https://www.amazon.sa/dp/B0CRB3DCZ6", // exact Amazon product page or null
    "note": null,                        // e.g. "Store sells 1 L, you asked 2 L"
    "want": true,                        // false = on the list but unticked
    "category": "Groceries",             // optional; guessed if missing
    "query": null, "must": null          // optional Amazon search text / words the title must contain
  }]
}
```
(Comments are for explanation only; real JSON has none.)

Rules enforced by `listlib.normalize_list`: https links only, no private hosts; `amazonUrl` must be an Amazon `/dp/` page
(stored as `https://www.amazon.sa/dp/<ASIN>`); a price needs `url` or `amazonUrl`; `amazonListUrl` must be
`/hz/wishlist/ls/<id>`; money is converted to whole halalas for totals; duplicates are merged.
