// Excel → SQL / R / Python bridge on the mission's own tables. Curated, hand-checked mappings only.
// SQL runs in the sandbox. R and Python are shown for comparison and are NOT executed in this release.
export const BRIDGE = [
  {
    id: "sumifs",
    concept: "Conditional total (SUMIFS)",
    business: "How many units are held at the port for one product?",
    excel: `=SUMIFS(Shipments[quantity_units], Shipments[product_id], "P-101", Shipments[status], "held_at_port")`,
    sql: `SELECT SUM(quantity_units) AS held_units
FROM shipments
WHERE product_id = 'P-101' AND status = 'held_at_port';`,
    r: `shipments |>
  dplyr::filter(product_id == "P-101", status == "held_at_port") |>
  dplyr::summarise(held_units = sum(quantity_units))`,
    python: `shipments.loc[(shipments.product_id == "P-101") &
              (shipments.status == "held_at_port"), "quantity_units"].sum()`,
    differences: [
      "SUMIFS ignores case when matching text (\"p-101\" matches \"P-101\"); SQLite's = is case-sensitive, and so are R and pandas.",
      "With no matching rows, SUMIFS returns 0; SQL SUM returns NULL. Wrap it as COALESCE(SUM(...), 0) if you need a zero.",
    ],
  },
  {
    id: "lookup",
    concept: "Lookup (XLOOKUP / VLOOKUP) → join",
    business: "Attach each shipment's unit value so you can value it.",
    excel: `=XLOOKUP([@product_id], Products[product_id], Products[unit_value_eur], "not found")`,
    sql: `SELECT s.shipment_id, s.product_id, p.unit_value_eur
FROM shipments s
LEFT JOIN products p ON p.product_id = s.product_id;`,
    r: `dplyr::left_join(shipments, products, by = "product_id")`,
    python: `shipments.merge(products, on="product_id", how="left")`,
    differences: [
      "XLOOKUP returns the first match only. A join returns one row per match, so a duplicated key in products would duplicate shipments.",
      "XLOOKUP is case-insensitive, so \"p-104\" still finds P-104. An exact SQL, R or pandas join does not: that shipment gets NULL / NA / NaN. Run this query and look for the empty unit value.",
      "A LEFT JOIN keeps unmatched shipments (with NULL); an inner JOIN silently drops them.",
    ],
  },
  {
    id: "if",
    concept: "Conditional logic (IF) → CASE",
    business: "Label each shipment as delayed or not on the as-of date.",
    excel: `=IF(AND([@status]<>"arrived", [@eta_date]<DATE(2026,3,2)), "delayed", "ok")`,
    sql: `SELECT shipment_id,
       CASE WHEN status <> 'arrived' AND eta_date < '2026-03-02'
            THEN 'delayed' ELSE 'ok' END AS flag
FROM shipments;`,
    r: `dplyr::mutate(shipments, flag = dplyr::if_else(
  status != "arrived" & eta_date < as.Date("2026-03-02"), "delayed", "ok"))`,
    python: `import numpy as np
shipments["flag"] = np.where((shipments.status != "arrived") &
    (pd.to_datetime(shipments.eta_date) < "2026-03-02"), "delayed", "ok")`,
    differences: [
      "Excel stores dates as serial numbers; this sandbox stores ISO text (YYYY-MM-DD), which compares correctly as text. Other formats (02/03/2026) would not.",
      "If status were blank, Excel's <> treats the blank as text, while SQL's <> on NULL is unknown and CASE falls to ELSE. Decide what a blank should mean.",
    ],
  },
  {
    id: "blanks",
    concept: "Blanks and errors (IFERROR / ISBLANK) → COALESCE / IS NULL",
    business: "Which arrived shipments have no arrival date recorded?",
    excel: `=IF(AND([@status]="arrived", ISBLANK([@actual_arrival_date])), "check date", "")`,
    sql: `SELECT shipment_id, status, actual_arrival_date
FROM shipments
WHERE status = 'arrived' AND actual_arrival_date IS NULL;`,
    r: `dplyr::filter(shipments, status == "arrived", is.na(actual_arrival_date))`,
    python: `shipments[(shipments.status == "arrived") & shipments.actual_arrival_date.isna()]`,
    differences: [
      "SQL never matches NULL with = NULL; use IS NULL. Excel's =\"\" and ISBLANK can disagree when a cell holds an empty string.",
      "IFERROR hides every error, including real mistakes. COALESCE only replaces NULL. Neither should be used to make a data problem disappear.",
    ],
  },
];

export const UNSUPPORTED_NOTE = "Only these curated mappings are offered. Other formulas are not translated automatically, because many Excel functions have no exact one-to-one equivalent (blank handling, text matching and ordering differ).";
