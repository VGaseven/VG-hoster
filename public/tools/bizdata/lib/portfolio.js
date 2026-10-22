// Private, replayable completion records. Stored only in this browser unless the student exports a file.
// CV bullets describe only what was actually done here: a simulated mission, synthetic data, the mode and help used.
import { MISSION_ID, DATASET_VERSION, BASE_SEED, COMPANY } from "./dataset.js";
import { L } from "../../shared/i18n.js";

export const RECORD_VERSION = 1;

export function buildRecord({ scenario, mode, hints, revealed, queries, checks, plan, assumptions, evidence, defense, evaluation, startedAt }) {
  return {
    record_version: RECORD_VERSION,
    title: "BizData completion record",
    mission: MISSION_ID, mission_title: "Rotterdam Port Bottleneck", company: COMPANY.name, fictional: true,
    dataset_version: DATASET_VERSION, seed: scenario.seed, variant: scenario.seed === BASE_SEED ? "base" : "fresh variant",
    mode, assistance: { hintsUsed: hints, referenceRevealed: revealed },
    started_at: startedAt, submitted_at: new Date().toISOString(),
    execution: { engine: "SQLite (sql.js WebAssembly) in the browser", isolation: "In-memory copy of the mission data, read-only, 4-second limit", queries },
    checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, { pass: !!v?.pass, messages: (v?.messages || []).map((m) => m.text) }])),
    plan, assumptions, evidence, defense,
    evaluation: { total: evaluation.total, max: evaluation.max, criteria: evaluation.criteria.map(({ id, label, score, max }) => ({ id, label, score, max })),
      defensible: evaluation.decision.defensible, dominatedBy: evaluation.decision.dominatedBy, outcome: evaluation.outcome },
    sharing: "private",
  };
}

/** What the mode label honestly supports. Guided or hinted work is never shown as independent mastery. */
export function demonstrated(record) {
  if (record.mode === "independent" && !record.assistance.hintsUsed && !record.assistance.referenceRevealed && record.variant === "fresh variant") return L("Completed independently on a fresh variant", "أُنجز باستقلالية على نسخة جديدة");
  if (record.mode === "guided") return L("Completed with guidance (worked example)", "أُنجز بإرشاد (مثال محلول)");
  const n = record.assistance.hintsUsed, shown = record.assistance.referenceRevealed;
  return L(`Completed with assistance (${n} hint${n === 1 ? "" : "s"}${shown ? ", reference query shown" : ""})`, `أُنجز بمساعدة (${n} تلميح${shown ? "، مع عرض الاستعلام المرجعي" : ""})`);
}

/** Editable CV bullets. Only facts from the record; no invented impact, employer or credential. */
export function cvBullets(record) {
  const checks = Object.entries(record.checks).filter(([, v]) => v.pass).map(([k]) => k);
  const facts = record.evaluation;
  const bullets = [
    L(`BizData simulated mission "Rotterdam Port Bottleneck" (fictional company, synthetic data): ${demonstrated(record)}.`, `مهمة BizData المحاكاة «اختناق ميناء روتردام» (شركة خيالية، بيانات اصطناعية): ${demonstrated(record)}.`),
  ];
  // Each data-quality claim only when the check that proves it passed.
  const handled = [checks.includes("delayed") && L("a blank arrival date", "تاريخ وصول فارغ"), checks.includes("exposure") && L("a mismatched join key", "مفتاح ربط غير متطابق"), checks.includes("freight") && L("duplicated invoices", "فواتير مكررة")].filter(Boolean);
  const including = handled.length ? L(`, including handling ${handled.join(" and ")}`, `، بما في ذلك معالجة ${handled.join(" و")}`) : "";
  if (checks.length) bullets.push(L(`Wrote SQL queries in a browser sandbox that passed ${checks.length} result check${checks.length > 1 ? "s" : ""} (${checks.join(", ")})${including}.`, `كتبت استعلامات SQL في بيئة معزولة داخل المتصفح نجحت في ${checks.length} من تحققات النتائج (${checks.join("، ")})${including}.`));
  bullets.push(L(`Compared mitigation strategies under a stated port-delay forecast and defended a recommendation against budget, capacity and service-level constraints (rubric ${facts.total}/${facts.max}).`, `قارنت استراتيجيات معالجة وفق توقع معلن لتأخير الميناء ودافعت عن توصية في ضوء قيود الميزانية والطاقة الاستيعابية ومستوى الخدمة (التقييم ${facts.total}/${facts.max}).`));
  return bullets;
}

export function toMarkdown(record) {
  const d = record.defense || {};
  return `# ${record.title}

**Mission:** ${record.mission_title} · ${record.company} (fictional; all data synthetic and simulated)
**Dataset:** ${record.dataset_version}, seed ${record.seed} (${record.variant}) · **Mode:** ${record.mode} · ${demonstrated(record)}
**Submitted:** ${record.submitted_at}

This is a BizData completion record of a simulated exercise. It is not an accredited certificate and is not endorsed by any employer, software vendor or professional body.

## Recommendation
${d.recommendation || ""}

- Expected cost (stated): €${d.claimedCost || "-"} · fill rate (stated): ${d.claimedFillPct || "-"}% · downside (P90): €${d.claimedP90 || "-"}
- Weakest if the delay is ${d.weakSpot || "-"} than expected.
${d.acceptShortfall ? `- Accepted service shortfall: ${d.shortfallReason}\n` : ""}
## Plan
\`\`\`json
${JSON.stringify(record.plan, null, 2)}
\`\`\`

## Evaluation (${record.evaluation.total}/${record.evaluation.max})
${record.evaluation.criteria.map((c) => `- ${c.label}: ${c.score}/${c.max}`).join("\n")}
- Decision quality: ${record.evaluation.defensible ? "defensible" : "not defensible as submitted"}${record.evaluation.dominatedBy.length ? ` (clearly beaten by: ${record.evaluation.dominatedBy.join(", ")})` : ""}
- Realized outcome (one simulated draw, not scored): delay ${record.evaluation.outcome.delayWeeks.toFixed(1)} weeks, cost €${Math.round(record.evaluation.outcome.cost).toLocaleString("en-GB")}

## Queries
${record.execution.queries.map((q) => `### ${q.check}${q.pass ? " ✓" : ""}\n\`\`\`sql\n${q.sql}\n\`\`\``).join("\n\n")}
`;
}
