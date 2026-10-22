import { L } from "../../shared/i18n.js";
// Excel → SQL / R / Python bridge on the mission's own tables. Curated, hand-checked mappings only.
// SQL runs in the sandbox. R and Python are shown for comparison and are NOT executed in this release.
export const BRIDGE = [
  {
    id: "sumifs",
    concept: L("Conditional total (SUMIFS)", "مجموع مشروط (SUMIFS)"),
    business: L("How many units are held at the port for one product?", "كم وحدة محتجزة في الميناء لمنتج واحد؟"),
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
      L("SUMIFS ignores case when matching text (\"p-101\" matches \"P-101\"); SQLite's = is case-sensitive, and so are R and pandas.", "تتجاهل SUMIFS حالة الأحرف عند مطابقة النص (\"p-101\" تطابق \"P-101\")؛ أما = في SQLite فتميّز حالة الأحرف، وكذلك R وpandas."),
      L("With no matching rows, SUMIFS returns 0; SQL SUM returns NULL. Wrap it as COALESCE(SUM(...), 0) if you need a zero.", "عند عدم وجود صفوف مطابقة تعيد SUMIFS صفرًا، بينما يعيد SUM في SQL القيمة NULL. استخدم COALESCE(SUM(...), 0) إن احتجت صفرًا."),
    ],
  },
  {
    id: "lookup",
    concept: L("Lookup (XLOOKUP / VLOOKUP) → join", "البحث (XLOOKUP / VLOOKUP) ← الربط"),
    business: L("Attach each shipment's unit value so you can value it.", "أرفق قيمة الوحدة بكل شحنة لتتمكن من تقييمها."),
    excel: `=XLOOKUP([@product_id], Products[product_id], Products[unit_value_eur], "not found")`,
    sql: `SELECT s.shipment_id, s.product_id, p.unit_value_eur
FROM shipments s
LEFT JOIN products p ON p.product_id = s.product_id;`,
    r: `dplyr::left_join(shipments, products, by = "product_id")`,
    python: `shipments.merge(products, on="product_id", how="left")`,
    differences: [
      L("XLOOKUP returns the first match only. A join returns one row per match, so a duplicated key in products would duplicate shipments.", "تعيد XLOOKUP أول تطابق فقط. أما الربط فيعيد صفًا لكل تطابق، فالمفتاح المكرر في products سيكرر الشحنات."),
      L("XLOOKUP is case-insensitive, so \"p-104\" still finds P-104. An exact SQL, R or pandas join does not: that shipment gets NULL / NA / NaN. Run this query and look for the empty unit value.", "XLOOKUP لا تميّز حالة الأحرف، فتجد \"p-104\" المنتج P-104. أما الربط التام في SQL أو R أو pandas فلا يجده: تحصل تلك الشحنة على NULL / NA / NaN. شغّل هذا الاستعلام وابحث عن قيمة الوحدة الفارغة."),
      L("A LEFT JOIN keeps unmatched shipments (with NULL); an inner JOIN silently drops them.", "يحتفظ LEFT JOIN بالشحنات غير المطابقة (مع NULL)؛ بينما يُسقطها الربط الداخلي دون تنبيه."),
    ],
  },
  {
    id: "if",
    concept: L("Conditional logic (IF) → CASE", "المنطق الشرطي (IF) ← CASE"),
    business: L("Label each shipment as delayed or not on the as-of date.", "صنّف كل شحنة كمتأخرة أو لا في تاريخ القرار."),
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
      L("Excel stores dates as serial numbers; this sandbox stores ISO text (YYYY-MM-DD), which compares correctly as text. Other formats (02/03/2026) would not.", "يخزّن Excel التواريخ كأرقام تسلسلية؛ وتخزّنها بيئة العزل كنص ISO (YYYY-MM-DD) يُقارَن بشكل صحيح كنص. الصيغ الأخرى (02/03/2026) لا تُقارَن بشكل صحيح."),
      L("If status were blank, Excel's <> treats the blank as text, while SQL's <> on NULL is unknown and CASE falls to ELSE. Decide what a blank should mean.", "لو كانت status فارغة، فإن <> في Excel تعامل الفراغ كنص، بينما <> في SQL على NULL نتيجتها مجهولة فيذهب CASE إلى ELSE. قرّر ماذا يجب أن يعني الفراغ."),
    ],
  },
  {
    id: "blanks",
    concept: L("Blanks and errors (IFERROR / ISBLANK) → COALESCE / IS NULL", "الفراغات والأخطاء (IFERROR / ISBLANK) ← COALESCE / IS NULL"),
    business: L("Which arrived shipments have no arrival date recorded?", "أي الشحنات الواصلة ليس لها تاريخ وصول مسجّل؟"),
    excel: `=IF(AND([@status]="arrived", ISBLANK([@actual_arrival_date])), "check date", "")`,
    sql: `SELECT shipment_id, status, actual_arrival_date
FROM shipments
WHERE status = 'arrived' AND actual_arrival_date IS NULL;`,
    r: `dplyr::filter(shipments, status == "arrived", is.na(actual_arrival_date))`,
    python: `shipments[(shipments.status == "arrived") & shipments.actual_arrival_date.isna()]`,
    differences: [
      L("SQL never matches NULL with = NULL; use IS NULL. Excel's =\"\" and ISBLANK can disagree when a cell holds an empty string.", "لا يطابق SQL القيمة NULL باستخدام = NULL؛ استخدم IS NULL. وقد يختلف =\"\" وISBLANK في Excel عندما تحتوي الخلية على نص فارغ."),
      L("IFERROR hides every error, including real mistakes. COALESCE only replaces NULL. Neither should be used to make a data problem disappear.", "تخفي IFERROR كل خطأ، بما فيها الأخطاء الحقيقية. ولا تستبدل COALESCE إلا NULL. ولا ينبغي استخدام أي منهما لإخفاء مشكلة في البيانات."),
    ],
  },
];

export const UNSUPPORTED_NOTE = L("Only these curated mappings are offered. Other formulas are not translated automatically, because many Excel functions have no exact one-to-one equivalent (blank handling, text matching and ordering differ).", "لا تُقدَّم إلا هذه المقابلات المنتقاة. لا تُترجم المعادلات الأخرى تلقائيًا، لأن كثيرًا من دوال Excel ليس لها مكافئ دقيق واحد لواحد (تختلف معالجة الفراغات ومطابقة النص والترتيب).");
