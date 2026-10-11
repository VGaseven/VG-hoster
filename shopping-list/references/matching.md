# Product matching (any category)

`listlib.match_product(requested, listing)` — Python port of CartFlow `core/cartflow-core.js` `matchProduct`.

| status | meaning | may be added without asking? |
|---|---|---|
| exact | brand, variant words, size and pack all match | yes |
| equivalent | same, but named with synonyms (moisture/hydration, colour/color, grey/gray) | yes |
| similar | different brand, size, pack, variant word, model number, storage, colour, clothing size, count or SPF | no — tell the user |
| unverified | the listing doesn't show something the request specifies (size, storage, colour, clothing size, count) | no |
| unavailable | out of stock / removed | no |

What to put in the request so matching works:
- Groceries: brand + product + size (`Almarai Full Fat Fresh Milk`, `2 L`). Fat level (full/low/skimmed), organic, decaf, sugar-free are variant words.
- Electronics: model number (`WH-1000XM5`), storage (`256GB`), colour, screen size (`27 inch`).
- Fashion: clothing size (`size M`, `XL`, `size 42`) and colour.
- Beauty: ml/g size and formula words (SPF number, sensitive, unscented, oily/dry).
- Baby: size (`size 4`) and count (`64 count`).
- Home: brand + product name (IKEA MARKUS); colour if it matters.

Sizes understood: ml, l/litre/liter, fl oz, g/gram, kg, oz, mg, "2 x 250 ml", "pack of 3", "64 count", "60 tablets".
Duplicates on updates use `identity_key` (brand + sorted name words + size + pack).
