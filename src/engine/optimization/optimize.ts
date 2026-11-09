/**
 * Schedule optimization: generates three alternative families for a conflict, evaluates
 * each with the full network simulation, and ranks them with a transparent weighted score.
 */
import type { Conflict, EconomicAssumptions, OptimizationOption, Project, ScenarioMetrics, ScheduleChange, Weights } from '@/types';
import { PRIORITIES, SHARED_ZONE_COMPATIBLE } from '@/data/organizations';
import { SEGMENT_BY_ID } from '@/data/network';
import { addDays, dayIndex, durationDays, fmtShort, HORIZON_START, isoFromDay } from '@/utils/date';
import { detectConflicts, detectPair } from '@/engine/conflicts/detect';
import { simulateSchedule } from '@/engine/traffic/simulate';

/** Primary weights follow the official outcomes (conflicts, repeated closures, closure extent×duration);
 *  traffic delay, detour and accessibility are supplementary modeled indicators. */
export const DEFAULT_WEIGHTS: Weights = { conflicts: 25, repeat: 20, closureDays: 20, delay: 15, accessibility: 10, detour: 5, shift: 5 };
/** Minimum buffer between sequential closures (days). */
export const BUFFER_DAYS = 1;

export function evaluateSchedule(projects: Project[], economics?: EconomicAssumptions): ScenarioMetrics {
  const conflicts = detectConflicts(projects);
  const sim = simulateSchedule(projects, { economics });
  return {
    ...sim,
    conflicts: conflicts.filter((c) => c.kind !== 'proximity' || c.category === 'sequential').length,
    highConflicts: conflicts.filter((c) => c.severity === 'high').length,
  };
}

export function applyChanges(projects: Project[], changes: ScheduleChange[]): Project[] {
  const m = new Map(changes.map((c) => [c.projectId, c]));
  return projects.map((p) => {
    const c = m.get(p.id);
    if (!c) return p;
    return { ...p, schedule: { ...c.to }, coordinationGroup: c.coordinationGroup ?? p.coordinationGroup };
  });
}

/** Candidates sorted so the lower-priority / more flexible project is tried first. */
function candidates(ps: Project[]) {
  return [...ps].sort((a, b) => PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank || flexDays(b) - flexDays(a));
}

export function flexDays(p: Project) {
  return dayIndex(p.latestEnd) - dayIndex(p.earliestStart) + 1 - durationDays(p.schedule);
}

const horizonStart = dayIndex(HORIZON_START);

/** Actionable conflicts the moved project would have with every other project at a candidate slot. */
function slotConflicts(x: Project, start: number, d: number, all: Project[]) {
  const moved = { ...x, schedule: { start: isoFromDay(start), end: isoFromDay(start + d - 1) } };
  let n = 0;
  for (const q of all) {
    if (q.id === x.id || q.status === 'rejected' || q.status === 'draft') continue;
    const c = detectPair(moved, q);
    if (c && (c.kind !== 'proximity' || c.category === 'sequential')) n++;
  }
  return n;
}

/**
 * Search the flexibility window (step 1 day) for the slot closest to the original plan that
 * separates the pair and introduces the fewest conflicts with ANY other project (0 preferred).
 */
function searchSlot(x: Project, other: Project, all: Project[], dir: 'earlier' | 'later') {
  const d = durationDays(x.schedule);
  const lo = Math.max(dayIndex(x.earliestStart), horizonStart);
  const hi = dayIndex(x.latestEnd) - d + 1;
  const cands: number[] = [];
  if (dir === 'later') for (let st = dayIndex(other.schedule.end) + 1 + BUFFER_DAYS; st <= hi; st++) cands.push(st);
  else for (let st = dayIndex(other.schedule.start) - BUFFER_DAYS - d; st >= lo; st--) cands.push(st);
  let best: { start: number; n: number } | null = null;
  for (const st of cands) {
    if (st < lo || st > hi) continue;
    if (dir === 'later' ? st <= dayIndex(x.schedule.start) : st >= dayIndex(x.schedule.start)) continue;
    const n = slotConflicts(x, st, d, all);
    if (!best || n < best.n) best = { start: st, n };
    if (n === 0) break;
  }
  return best ? { start: best.start, end: best.start + d - 1, residual: best.n } : null;
}

function makeEarlier(conflict: Conflict, byId: Map<string, Project>, all: Project[] = [...byId.values()]) {
  const ps = conflict.projectIds.map((id) => byId.get(id)!);
  const reasons: string[] = [];
  for (const x of candidates(ps)) {
    const other = ps.find((p) => p.id !== x.id)!;
    const d = durationDays(x.schedule);
    const latestStart = dayIndex(other.schedule.start) - 1 - BUFFER_DAYS - d + 1;
    if (latestStart >= dayIndex(x.schedule.start)) {
      reasons.push(`«${x.title}» يبدأ أصلاً قبل الآخر؛ التقديم لا يفصل بينهما.`);
      continue;
    }
    if (latestStart < dayIndex(x.earliestStart) || latestStart < horizonStart) {
      reasons.push(`تقديم «${x.title}» يتطلب البدء في ${fmtShort(isoFromDay(latestStart))} وهو قبل أبكر موعد مسموح (${fmtShort(x.earliestStart)}).`);
      continue;
    }
    const slot = searchSlot(x, other, all, 'earlier')!;
    return { x, residual: slot.residual, change: { projectId: x.id, from: x.schedule, to: { start: isoFromDay(slot.start), end: isoFromDay(slot.end) } } as ScheduleChange };
  }
  return { reasons };
}

function makeDelay(conflict: Conflict, byId: Map<string, Project>, all: Project[] = [...byId.values()]) {
  const ps = conflict.projectIds.map((id) => byId.get(id)!);
  const reasons: string[] = [];
  for (const x of candidates(ps)) {
    const other = ps.find((p) => p.id !== x.id)!;
    const d = durationDays(x.schedule);
    const firstStart = dayIndex(other.schedule.end) + 1 + BUFFER_DAYS;
    if (firstStart <= dayIndex(x.schedule.start)) {
      reasons.push(`«${x.title}» يبدأ أصلاً بعد انتهاء الآخر.`);
      continue;
    }
    if (firstStart + d - 1 > dayIndex(x.latestEnd)) {
      reasons.push(`تأخير «${x.title}» ينهيه في ${fmtShort(isoFromDay(firstStart + d - 1))} بعد آخر موعد إنجاز مسموح (${fmtShort(x.latestEnd)}).`);
      continue;
    }
    const slot = searchSlot(x, other, all, 'later')!;
    return { x, residual: slot.residual, change: { projectId: x.id, from: x.schedule, to: { start: isoFromDay(slot.start), end: isoFromDay(slot.end) } } as ScheduleChange };
  }
  return { reasons };
}

/** Coordinated shared work window — only where technically compatible on the same block. */
function makeCoordinated(conflict: Conflict, byId: Map<string, Project>, all: Project[]) {
  let ps = conflict.projectIds.map((id) => byId.get(id)!);
  const segs0 = new Set(ps[0].closures.map((c) => c.segmentId));
  const shared = ps[1].closures.some((c) => segs0.has(c.segmentId));
  if (!shared)
    return {
      reasons: [
        'المشروعان على مقطعين مختلفين؛ تنفيذهما في نفس النافذة يغلق الطريق ومساره البديل معاً، لذا لا يُعد التنفيذ المتزامن آمناً أو مجدياً للشبكة.',
      ],
    };
  // Expand to every project closing this block in a sequential chain (e.g. 3 utilities)
  if (conflict.category === 'sequential' || conflict.category === 'direct') {
    const segId = [...segs0].find((s) => ps[1].closures.some((c) => c.segmentId === s))!;
    const sameBlock = all.filter((p) => p.closures.some((c) => c.segmentId === segId) && p.status !== 'rejected' && p.status !== 'draft');
    const linked = sameBlock.filter((p) => ps.some((q) => q.id === p.id) || sameBlock.some((q) => q.id !== p.id && ps.some((r) => r.id === q.id) && detectPair(p, q)));
    if (linked.length > ps.length) ps = linked;
  }
  const reasons: string[] = [];
  for (const a of ps)
    for (const b of ps)
      if (a.id < b.id && !SHARED_ZONE_COMPATIBLE[a.category].includes(b.category))
        reasons.push(`أعمال «${a.title}» و«${b.title}» غير متوافقة فنياً لمنطقة عمل مشتركة.`);
  if (ps.some((p) => p.closureType !== ps[0].closureType)) reasons.push('نوع الإغلاق مختلف (كلي/جزئي) بين المشاريع، فلا يمكن توحيد منطقة العمل بأمان.');
  const segId = ps[0].closures[0].segmentId;
  const seg = SEGMENT_BY_ID.get(segId)!;
  const lanes = Math.max(...ps.map((p) => (p.closureType === 'full' ? seg.lanesPerDirection : p.affectedLanes)));
  if (ps[0].closureType === 'partial' && lanes >= seg.lanesPerDirection) reasons.push('منطقة العمل المشتركة لا تُبقي مساراً مفتوحاً للحركة (حد السلامة الأدنى).');
  const start = Math.max(Math.min(...ps.map((p) => dayIndex(p.schedule.start))), ...ps.map((p) => dayIndex(p.earliestStart)), horizonStart);
  const changes: ScheduleChange[] = [];
  const gid = `CG-${ps.map((p) => p.id.replace('RASD-', '')).join('-')}`;
  for (const p of ps) {
    const end = start + durationDays(p.schedule) - 1;
    if (end > dayIndex(p.latestEnd)) reasons.push(`«${p.title}» لن ينتهي قبل آخر موعد مسموح (${fmtShort(p.latestEnd)}) ضمن النافذة المشتركة.`);
    changes.push({ projectId: p.id, from: p.schedule, to: { start: isoFromDay(start), end: isoFromDay(end) }, coordinationGroup: gid });
  }
  // Working hours must be aligned to a common window for a shared zone
  if (reasons.length) return { reasons };
  return { changes, ps };
}

function shiftOf(changes: ScheduleChange[]) {
  return changes.reduce((s, c) => s + Math.abs(dayIndex(c.to.start) - dayIndex(c.from.start)), 0);
}

export interface OptimizationResult {
  conflict: Conflict;
  current: ScenarioMetrics;
  options: OptimizationOption[];
  weights: Weights;
}

export function generateOptions(conflict: Conflict, projects: Project[], weights: Weights = DEFAULT_WEIGHTS, economics?: EconomicAssumptions): OptimizationResult {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const current = evaluateSchedule(projects, economics);
  const options: OptimizationOption[] = [];

  const evalChanges = (changes: ScheduleChange[]) => evaluateSchedule(applyChanges(projects, changes), economics);

  const e = makeEarlier(conflict, byId, projects);
  if ('change' in e && e.change) {
    const m = evalChanges([e.change]);
    options.push({
      id: `${conflict.id}-A`, kind: 'earlier', titleAr: 'تقديم الموعد حسب المرونة', titleEn: 'Earlier, within flexibility', feasible: true,
      changes: [e.change], metrics: m, shiftDays: shiftOf([e.change]),
      tradeoffsAr: [
        `تقديم «${e.x.title}» ليبدأ ${fmtShort(e.change.to.start)} وينتهي ${fmtShort(e.change.to.end)} — أقرب نافذة ضمن المرونة ${e.residual ? `(تبقى ${e.residual} تعارضات محتملة مع مشاريع أخرى)` : 'لا تُنشئ تعارضاً مع مشاريع أخرى'}.`,
        'يتطلب جاهزية الجهة للبدء مبكراً (تصاريح، مواد، فرق).',
      ],
      score: 0, recommended: false,
    });
  } else {
    options.push({ id: `${conflict.id}-A`, kind: 'earlier', titleAr: 'تقديم الموعد حسب المرونة', titleEn: 'Earlier, within flexibility', feasible: false, infeasibleReasonAr: (e as { reasons: string[] }).reasons.join(' '), changes: [], metrics: null, shiftDays: 0, tradeoffsAr: [], score: 0, recommended: false });
  }

  const dl = makeDelay(conflict, byId, projects);
  if ('change' in dl && dl.change) {
    const m = evalChanges([dl.change]);
    options.push({
      id: `${conflict.id}-B`, kind: 'delay', titleAr: 'تأخير الموعد حسب الأولوية', titleEn: 'Delay by priority', feasible: true,
      changes: [dl.change], metrics: m, shiftDays: shiftOf([dl.change]),
      tradeoffsAr: [
        `تأخير «${dl.x.title}» (أولوية ${PRIORITIES[dl.x.priority].ar}) ليبدأ ${fmtShort(dl.change.to.start)} وينتهي ${fmtShort(dl.change.to.end)}، ضمن آخر موعد مسموح ${fmtShort(dl.x.latestEnd)} — أقرب نافذة ${dl.residual ? `تُبقي ${dl.residual} تعارضات محتملة` : 'لا تُنشئ تعارضاً مع مشاريع أخرى'}.`,
        'يؤجل استفادة الجهة من المشروع ويطيل الفترة الإجمالية للأعمال في المنطقة.',
      ],
      score: 0, recommended: false,
    });
  } else {
    options.push({ id: `${conflict.id}-B`, kind: 'delay', titleAr: 'تأخير الموعد حسب الأولوية', titleEn: 'Delay by priority', feasible: false, infeasibleReasonAr: (dl as { reasons: string[] }).reasons.join(' '), changes: [], metrics: null, shiftDays: 0, tradeoffsAr: [], score: 0, recommended: false });
  }

  const co = makeCoordinated(conflict, byId, projects);
  if ('changes' in co && co.changes) {
    const m = evalChanges(co.changes);
    const before = new Set<number>();
    const after = new Set<number>();
    for (const c of co.changes) {
      for (let d = dayIndex(c.from.start); d <= dayIndex(c.from.end); d++) before.add(d);
      for (let d = dayIndex(c.to.start); d <= dayIndex(c.to.end); d++) after.add(d);
    }
    options.push({
      id: `${conflict.id}-C`, kind: 'coordinated', titleAr: 'نافذة مشتركة إذا أمكن فنيًا', titleEn: 'Shared window if technically feasible', feasible: true,
      changes: co.changes, metrics: m, shiftDays: shiftOf(co.changes),
      tradeoffsAr: [
        `منطقة عمل مشتركة واحدة لـ ${co.ps!.length} مشاريع تبدأ ${fmtShort(co.changes[0].to.start)}؛ أيام إغلاق المقطع ${after.size} بدلاً من ${before.size}.`,
        'يتطلب خطة سلامة موحدة وتنسيق فرق العمل والمقاولين في موقع واحد.',
        'الافتراض: الأعمال المتوافقة تشترك في نفس الحفرية/المسارات المغلقة (عرض الإغلاق = الأكبر بين المشاريع).',
        'لا يُوصى به تلقائياً: يتطلب تأكيداً فنياً من الجهتين قبل الاعتماد.',
      ],
      score: 0, recommended: false,
    });
  } else {
    options.push({ id: `${conflict.id}-C`, kind: 'coordinated', titleAr: 'نافذة مشتركة إذا أمكن فنيًا', titleEn: 'Shared window if technically feasible', feasible: false, infeasibleReasonAr: (co as { reasons: string[] }).reasons.join(' '), changes: [], metrics: null, shiftDays: 0, tradeoffsAr: [], score: 0, recommended: false });
  }

  rankOptions(options, current, weights);
  return { conflict, current, options, weights };
}

/** Transparent weighted score: each metric normalized by the worst value among current + options. */
export function rankOptions(options: OptimizationOption[], current: ScenarioMetrics, w: Weights) {
  const feas = options.filter((o) => o.feasible && o.metrics);
  const pool = [current, ...feas.map((o) => o.metrics!)];
  const maxOf = (f: (m: ScenarioMetrics) => number) => Math.max(1e-9, ...pool.map(f));
  const mx = {
    conflicts: maxOf((m) => m.conflicts),
    delay: maxOf((m) => m.vehicleHoursDelay),
    closureDays: maxOf((m) => m.closureKmDays),
    repeat: maxOf((m) => m.closureEpisodes),
    detour: maxOf((m) => m.detourVehicleKm),
    access: maxOf((m) => 100 - m.accessibilityScore),
    shift: Math.max(1, ...feas.map((o) => o.shiftDays)),
  };
  const wr = w.repeat ?? 0;
  const total = w.conflicts + wr + w.delay + w.closureDays + w.detour + w.accessibility + w.shift || 1;
  for (const o of options) {
    if (!o.feasible || !o.metrics) {
      o.score = 0;
      o.recommended = false;
      continue;
    }
    const m = o.metrics;
    const penalty =
      w.conflicts * (m.conflicts / mx.conflicts) +
      w.delay * (m.vehicleHoursDelay / mx.delay) +
      w.closureDays * (m.closureKmDays / mx.closureDays) +
      wr * (m.closureEpisodes / mx.repeat) +
      w.detour * (m.detourVehicleKm / mx.detour) +
      w.accessibility * ((100 - m.accessibilityScore) / mx.access) +
      w.shift * (o.shiftDays / mx.shift);
    o.score = Math.round((100 - (penalty / total) * 100) * 10) / 10;
  }
  // Official policy: a shared execution window is never recommended automatically — it is
  // offered only as "feasible subject to technical confirmation by both entities".
  const ranked = [...feas].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const best = ranked.find((o) => o.kind !== 'coordinated');
  for (const o of options) {
    o.recommended = !!best && o.id === best.id;
    o.topScore = !!top && o.id === top.id;
    o.requiresTechnicalConfirmation = o.kind === 'coordinated';
  }
  return options;
}

export function changeSummary(c: ScheduleChange) {
  const delta = dayIndex(c.to.start) - dayIndex(c.from.start);
  return { delta, label: delta === 0 ? 'دون تغيير' : delta > 0 ? `تأخير ${delta} يوم` : `تقديم ${-delta} يوم` };
}

export { addDays };
