// Rotterdam Port Bottleneck: synthetic, seeded dataset for a fictional company.
// Every number here is simulated. Nothing describes a real company, port authority report or market.
import { rng, randInt } from "./prng.js";
import { lang } from "../../shared/i18n.js";

export const MISSION_ID = "rotterdam-port-bottleneck";
export const DATASET_VERSION = "rotterdam-v1";
export const BASE_SEED = 20260302;
export const AS_OF = "2026-03-02";

export const COMPANY = {
  name: "Kestrel Home Goods B.V.",
  note: "Fictional mid-sized importer of home goods. Sources in Asia, ships through Rotterdam, sells from one distribution centre (DC) in Venlo to retail partners.",
};

// name, category, landed unit cost range (EUR), weekly demand range (units), gross margin per unit as share of cost, units per pallet
const CATALOGUE = [
  ["Oak dining chair", "Furniture", [38, 52], [140, 220], 0.9, 12],
  ["Linen duvet set", "Textiles", [22, 30], [260, 380], 1.1, 40],
  ["Ceramic cookware set", "Kitchen", [31, 44], [120, 190], 0.8, 24],
  ["LED floor lamp", "Lighting", [19, 27], [180, 260], 1.0, 30],
  ["Wool rug 160x230", "Textiles", [64, 88], [60, 95], 0.85, 10],
  ["Glass storage jars (6)", "Kitchen", [7, 10], [520, 760], 1.3, 120],
  ["Bamboo shelf unit", "Furniture", [27, 36], [90, 140], 0.95, 16],
  ["Cotton towel bundle", "Textiles", [9, 13], [430, 620], 1.2, 90],
  ["Stainless kettle", "Kitchen", [14, 19], [210, 300], 1.0, 48],
  ["Outdoor lounger", "Garden", [55, 74], [45, 80], 0.75, 8],
];

/** ISO date (YYYY-MM-DD) shifted by whole days, in UTC so the result never depends on the viewer's time zone. */
export function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (fromIso, toIso) => Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400000);

/**
 * Builds the mission's tables for a seed. The base seed is the guided mission; other seeds are fresh
 * variants with different products, quantities and delays but the same rules and data-quality traps.
 */
export function buildScenario(seed = BASE_SEED) {
  const rand = rng(seed);
  // Seeded Fisher-Yates (a random sort comparator would differ between browsers).
  const order = [...CATALOGUE.keys()];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const pick = order.slice(0, 8).sort((x, y) => x - y);
  const products = [], inventory = [], shipments = [], reroute = [], backup = [], invoices = [];
  let shipmentNo = 4100 + randInt(rand, 0, 300);
  let invoiceNo = 88000 + randInt(rand, 0, 900);
  const suppliers = ["Ningbo Crafted Living", "Shenzhen Brightline", "Ho Chi Minh Homeworks", "Qingdao Textile Partners"];

  pick.forEach((ci, i) => {
    const [name, category, cost, demand, marginShare, perPallet] = CATALOGUE[ci];
    const id = `P-${101 + i}`;
    const unitValue = randInt(rand, cost[0], cost[1]);
    const weekly = Math.round(randInt(rand, demand[0], demand[1]) / 5) * 5;
    products.push({
      product_id: id, product_name: name, category, unit_value_eur: unitValue,
      gross_margin_per_unit_eur: Math.round(unitValue * marginShare * 100) / 100,
      weekly_demand_units: weekly, units_per_pallet: perPallet,
    });
    const coverWeeks = 1.2 + rand() * 1.6; // the DC holds 1.2 to 2.8 weeks of demand today
    inventory.push({ product_id: id, dc: "Venlo DC", on_hand_units: Math.round(weekly * coverWeeks), safety_stock_units: Math.round(weekly * 1.0), reorder_point_units: Math.round(weekly * 2.5) });

    const supplier = suppliers[i % suppliers.length];
    // Normal supply roughly matches 8 weeks of demand; the congestion, not the plan, creates the gap.
    const plan = [
      { status: "arrived", eta: -randInt(rand, 15, 22), weeks: [1.2, 1.8] },
      { status: "held_at_port", eta: -randInt(rand, 2, 12), weeks: [1.2, 1.8] },
      { status: "in_transit", eta: randInt(rand, 16, 24), weeks: [1.8, 2.4] },
      { status: "in_transit", eta: randInt(rand, 35, 45), weeks: [1.8, 2.4] },
    ];
    if (rand() < 0.5) plan.push({ status: "held_at_port", eta: -randInt(rand, 2, 12), weeks: [0.5, 0.9] });
    for (const p of plan) {
      const qty = Math.round((weekly * (p.weeks[0] + rand() * (p.weeks[1] - p.weeks[0]))) / 10) * 10;
      const eta = addDays(AS_OF, p.eta);
      const actual = p.status === "arrived" ? addDays(eta, randInt(rand, 0, 3)) : null;
      shipments.push({ shipment_id: `SH-${shipmentNo++}`, product_id: id, supplier, origin_port: i % 2 ? "Shanghai" : "Ningbo",
        destination_dc: "Venlo DC", quantity_units: qty, eta_date: eta, actual_arrival_date: actual, status: p.status });
    }
  });

  // One vessel is past its ETA but still at sea: delayed, though it is not at the port and cannot be rerouted.
  const atSea = shipments.find((s) => s.status === "in_transit");
  atSea.eta_date = addDays(AS_OF, -randInt(rand, 1, 4));

  // Data-quality traps a careful analyst should notice rather than silently "clean".
  const arrived = shipments.filter((s) => s.status === "arrived");
  const missingDate = [arrived[1], arrived[3], arrived[6]].filter(Boolean);
  for (const s of missingDate) s.actual_arrival_date = null; // arrived per the terminal status feed, date not keyed in
  const held = shipments.filter((s) => s.status === "held_at_port");
  const badKey = held[2];
  badKey.product_id = badKey.product_id.toLowerCase(); // keyed by hand as "p-10x": an exact-match join drops it

  const productOf = (s) => products.find((p) => p.product_id === s.product_id.toUpperCase());
  for (const s of shipments) {
    const value = s.quantity_units * productOf(s).unit_value_eur;
    invoices.push({ invoice_id: `FI-${invoiceNo++}`, shipment_id: s.shipment_id, amount_eur: Math.round(value * 0.055) });
  }
  const dupes = held.slice(0, 2).map((s) => invoices.find((f) => f.shipment_id === s.shipment_id));
  for (const d of dupes) invoices.push({ ...d }); // the same invoice imported twice by the freight portal

  for (const s of held) {
    const value = s.quantity_units * productOf(s).unit_value_eur;
    reroute.push({ shipment_id: s.shipment_id, route: "Antwerp barge + truck", extra_cost_eur: Math.round((1600 + value * 0.04) / 10) * 10, arrival_days: randInt(rand, 5, 9) });
  }
  for (const p of products) {
    backup.push({ product_id: p.product_id, supplier: "Brabant Home Supply (EU)", premium_pct: 0.24, lead_time_weeks: 1 });
    backup.push({ product_id: p.product_id, supplier: "Izmir Home Partners (TR)", premium_pct: 0.1, lead_time_weeks: 3 });
  }

  // Budget: 75% of the value stuck in delayed shipments, so buying full cover for everything is not affordable.
  const valueAtRisk = shipments.filter((x) => x.status !== "arrived" && x.eta_date < AS_OF).reduce((sum, x) => sum + x.quantity_units * productOf(x).unit_value_eur, 0);
  const budget = Math.round((valueAtRisk * 0.75) / 5000) * 5000;
  const freePallets = Math.round(products.reduce((s, p) => s + (p.weekly_demand_units * 1.6) / p.units_per_pallet, 0) / 10) * 10;
  return {
    seed, mission: MISSION_ID, dataset_version: DATASET_VERSION, company: COMPANY,
    tables: {
      mission_info: [{ as_of_date: AS_OF, horizon_weeks: 8, emergency_budget_eur: budget, antwerp_slots: Math.max(3, Math.round(held.length / 3)), service_target: 0.95, holding_rate_per_year: 0.25, markdown_rate: 0.15, excess_cover_weeks: 6, currency: "EUR" }],
      products, inventory, shipments, freight_invoices: invoices, reroute_options: reroute, backup_suppliers: backup,
      warehouse: [{ dc: "Venlo DC", free_pallet_positions: freePallets, overflow_rate_eur_pallet_week: 9, lease_block_pallets: Math.round(freePallets * 0.8 / 10) * 10, lease_cost_eur_week: 2400, lease_min_weeks: 8 }],
    },
    // Recorded so feedback can explain mistakes precisely; students discover these through the data.
    traps: { missingArrivalDate: missingDate.map((s) => s.shipment_id), lowercaseProduct: badKey.shipment_id, duplicateInvoices: dupes.map((d) => d.invoice_id), atSeaLate: atSea.shipment_id },
  };
}

/** Port release forecast published in the briefing: the information available when the decision is made. */
export const BRIEFING_DELAY = { min: 1.5, mode: 3, max: 7 };

// ---- Column documentation (shown in the evidence explorer) ----
const SCHEMA_EN = {
  mission_info: { _about: "One row of mission constants.", as_of_date: "Decision date. All 'late' calculations compare with this date, not today's date.", horizon_weeks: "Planning horizon for the forecast.", emergency_budget_eur: "Cash the COO can approve for this disruption.", antwerp_slots: "Barge slots available from Antwerp this week: the most containers you can reroute.", service_target: "Required fill rate (share of demand served from stock).", holding_rate_per_year: "Cost of holding inventory per year, as a share of its value.", markdown_rate: "Discount needed to clear stock above the excess-cover threshold at the end of the horizon.", excess_cover_weeks: "Stock above this many weeks of demand at week 8 counts as excess.", currency: "All money is in euros (EUR)." },
  products: { _about: "One row per product.", product_id: "Product key, upper case (P-101…).", unit_value_eur: "Landed cost per unit (EUR).", gross_margin_per_unit_eur: "Margin lost for each unit of demand not served.", weekly_demand_units: "Average units sold per week (planning forecast).", units_per_pallet: "Units that fit on one pallet position." },
  inventory: { _about: "Stock at the Venlo DC on the as-of date.", on_hand_units: "Units physically available to ship.", safety_stock_units: "Current policy buffer (1 week of demand).", reorder_point_units: "Current policy trigger for a new order (2.5 weeks)." },
  shipments: { _about: "Inbound sea shipments.", product_id: "Should match products.product_id. Check how it is typed.", quantity_units: "Units on the shipment.", eta_date: "Carrier's estimated arrival at the DC (ISO date).", actual_arrival_date: "Date received at the DC. Can be blank even when status is 'arrived'.", status: "arrived, in_transit (at sea) or held_at_port (in Rotterdam, waiting for release)." },
  freight_invoices: { _about: "Freight charges imported from the forwarder's portal.", invoice_id: "Invoice number. Each invoice should appear once.", amount_eur: "Invoice amount (EUR)." },
  reroute_options: { _about: "Quotes to move a held container via Antwerp.", extra_cost_eur: "Additional cost if rerouted (EUR).", arrival_days: "Days from today until it reaches the DC if rerouted." },
  backup_suppliers: { _about: "Emergency buy options, priced as a premium over normal landed cost.", premium_pct: "Extra cost over unit_value_eur, as a share.", lead_time_weeks: "Weeks until goods reach the DC." },
  warehouse: { _about: "DC space.", free_pallet_positions: "Empty pallet spaces today.", overflow_rate_eur_pallet_week: "3PL overflow storage price per pallet per week.", lease_block_pallets: "Extra space available by short-term lease.", lease_cost_eur_week: "Lease price per week (minimum 8 weeks)." },
};

const SCHEMA_AR = {
  mission_info: { _about: "صف واحد من ثوابت المهمة.", as_of_date: "تاريخ القرار. كل حسابات «التأخر» تُقارَن بهذا التاريخ، لا بتاريخ اليوم.", horizon_weeks: "أفق التخطيط للتوقع.", emergency_budget_eur: "النقد الذي يمكن لمدير العمليات اعتماده لهذا الاضطراب.", antwerp_slots: "خانات النقل النهري المتاحة من أنتويرب هذا الأسبوع: أقصى عدد من الحاويات يمكنك إعادة توجيهها.", service_target: "معدل التلبية المطلوب (نسبة الطلب المخدوم من المخزون).", holding_rate_per_year: "تكلفة الاحتفاظ بالمخزون سنويًا كنسبة من قيمته.", markdown_rate: "التخفيض اللازم لتصفية المخزون الزائد عن حد التغطية في نهاية الأفق.", excess_cover_weeks: "المخزون الذي يتجاوز هذا العدد من أسابيع الطلب في الأسبوع 8 يُعد فائضًا.", currency: "كل المبالغ باليورو (EUR)." },
  products: { _about: "صف لكل منتج.", product_id: "مفتاح المنتج، بأحرف كبيرة (P-101…).", unit_value_eur: "تكلفة الوحدة الواصلة (يورو).", gross_margin_per_unit_eur: "الهامش المفقود لكل وحدة طلب غير مخدومة.", weekly_demand_units: "متوسط الوحدات المبيعة أسبوعيًا (توقع التخطيط).", units_per_pallet: "الوحدات التي تتسع لها منصّة واحدة." },
  inventory: { _about: "المخزون في مركز توزيع فينلو في تاريخ القرار.", on_hand_units: "الوحدات المتاحة فعليًا للشحن.", safety_stock_units: "مخزون الأمان في السياسة الحالية (طلب أسبوع).", reorder_point_units: "نقطة إعادة الطلب في السياسة الحالية (2.5 أسبوع)." },
  shipments: { _about: "الشحنات البحرية الواردة.", product_id: "يجب أن يطابق products.product_id. تحقّق من طريقة كتابته.", quantity_units: "عدد الوحدات في الشحنة.", eta_date: "موعد الوصول المتوقع إلى المركز بحسب الناقل (تاريخ ISO).", actual_arrival_date: "تاريخ الاستلام في المركز. قد يكون فارغًا حتى عندما تكون الحالة 'arrived'.", status: "arrived (وصلت) أو in_transit (في البحر) أو held_at_port (في روتردام بانتظار الإفراج)." },
  freight_invoices: { _about: "رسوم الشحن المستوردة من بوابة وكيل الشحن.", invoice_id: "رقم الفاتورة. يجب أن تظهر كل فاتورة مرة واحدة.", amount_eur: "مبلغ الفاتورة (يورو)." },
  reroute_options: { _about: "عروض نقل حاوية محتجزة عبر أنتويرب.", extra_cost_eur: "التكلفة الإضافية عند إعادة التوجيه (يورو).", arrival_days: "الأيام من اليوم حتى وصولها إلى المركز عند إعادة التوجيه." },
  backup_suppliers: { _about: "خيارات الشراء الطارئ، مسعّرة كعلاوة على التكلفة العادية.", premium_pct: "التكلفة الإضافية فوق unit_value_eur كنسبة.", lead_time_weeks: "الأسابيع حتى وصول البضاعة إلى المركز." },
  warehouse: { _about: "مساحة المركز.", free_pallet_positions: "مواضع المنصّات الفارغة اليوم.", overflow_rate_eur_pallet_week: "سعر التخزين الخارجي لكل منصّة أسبوعيًا.", lease_block_pallets: "مساحة إضافية متاحة بالاستئجار قصير الأجل.", lease_cost_eur_week: "سعر الاستئجار أسبوعيًا (بحد أدنى 8 أسابيع)." },
};
/** Column notes in the page language (English in tests). */
export const SCHEMA = lang() === "ar" ? Object.fromEntries(Object.entries(SCHEMA_EN).map(([t, cols]) => [t, { ...cols, ...SCHEMA_AR[t] }])) : SCHEMA_EN;

/** SQL script that loads a scenario into an empty SQLite database. */
export function toSqlScript(scenario) {
  const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const typeOf = (rows, col) => (rows.some((r) => typeof r[col] === "number") ? (rows.every((r) => r[col] === null || Number.isInteger(r[col])) ? "INTEGER" : "REAL") : "TEXT");
  let sql = "";
  for (const [table, rows] of Object.entries(scenario.tables)) {
    const cols = Object.keys(rows[0]);
    sql += `CREATE TABLE ${table} (${cols.map((c) => `${c} ${typeOf(rows, c)}`).join(", ")});\n`;
    for (const r of rows) sql += `INSERT INTO ${table} VALUES (${cols.map((c) => q(r[c])).join(", ")});\n`;
  }
  return sql;
}
