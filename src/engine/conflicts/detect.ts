/**
 * RASD rule-based spatial–temporal conflict detection engine.
 *
 * Every conflict carries explicit evidence and an evidence KIND:
 *   geometric  — confirmed geometric overlap (Turf) of closure extents during overlapping time
 *   network    — modeled network conflict (traffic assignment shows interacting closures)
 *   proximity  — proximity-only risk warning (NOT proof of congestion)
 */
import type { Conflict, ConflictCategory, ConflictEvidence, EvidenceKind, LngLat, Project, Severity } from '@/types';
import { SEGMENT_BY_ID, ZONES } from '@/data/network';
import { minDistanceKm, overlapLengthKm, projectMidpoint } from '@/engine/spatial/geometry';
import { assign, BANDS, BASELINE, HOURLY_FACTORS, bandOfHour, hourlyDelay, odKey, OD_PAIRS, zoneAccessibility } from '@/engine/traffic/assignment';
import { combineEffects, isSimulated } from '@/engine/traffic/effects';
import { gapDays, overlapDays } from '@/utils/date';
import { PRIORITIES } from '@/data/organizations';
import { fmtShort } from '@/utils/date';

export const RULES = {
  NEARBY_KM: 0.8,
  SEQUENTIAL_KM: 0.3,
  SEQUENTIAL_GAP_DAYS: 45,
  MOVEMENT_JACCARD: 0.15,
  DETOUR_MIN_VPH: 1200,
  DETOUR_MIN_SHARE: 0.4,
  ACCESS_DROP_POINTS: 8,
  ACCESS_EXTRA_POINTS: 4,
};

const CATEGORY_AR: Record<ConflictCategory, string> = {
  direct: 'تداخل مباشر',
  nearby: 'إغلاقات متجاورة',
  detour: 'تعارض مسار التحويل',
  access: 'تعطّل الوصول',
  sequential: 'إغلاقات متتابعة',
};
export const CATEGORY_LABELS = CATEGORY_AR;
export const CATEGORY_LABELS_EN: Record<ConflictCategory, string> = {
  direct: 'Direct overlap',
  nearby: 'Nearby closures',
  detour: 'Detour conflict',
  access: 'Access disruption',
  sequential: 'Sequential disruption',
};
export const KIND_LABELS: Record<EvidenceKind, { ar: string; en: string }> = {
  geometric: { ar: 'تعارض هندسي مؤكد', en: 'Confirmed geometric conflict' },
  network: { ar: 'تعارض شبكي مُنمذج', en: 'Modeled network conflict' },
  proximity: { ar: 'تحذير قرب (مخاطرة)', en: 'Proximity risk warning' },
};
export const SEVERITY_LABELS: Record<Severity, { ar: string; en: string }> = {
  high: { ar: 'تعارض مرتفع', en: 'High' },
  medium: { ar: 'تعارض متوسط', en: 'Medium' },
  low: { ar: 'تعارض منخفض', en: 'Low' },
};

function hoursOverlap(a: Project, b: Project): [number, number] | null {
  const s = Math.max(a.workHours.start, b.workHours.start);
  const e = Math.min(a.workHours.end, b.workHours.end);
  return e > s ? [s, e] : null;
}

/** Highest demand band within an hour window (the most critical time both closures coexist). */
function criticalBand(win: [number, number]): number {
  let best = 0;
  let bestF = -1;
  for (let h = win[0]; h < win[1]; h++)
    if (HOURLY_FACTORS[h] > bestF) {
      bestF = HOURLY_FACTORS[h];
      best = bandOfHour(h);
    }
  return best;
}

interface SoloAnalysis {
  delay: number;
  displacedTrips: number;
  /** segment → trips rerouted onto it because of this closure */
  detourOnto: Map<string, number>;
  /** OD keys whose baseline path uses this project's segments, with trips */
  users: Map<string, number>;
  /** segment → equilibrium two-way flow increase (veh/h) */
  flowIncrease: Map<string, number>;
}

const soloCache = new Map<string, SoloAnalysis>();

function soloKey(p: Project, band: number) {
  return `${band}|${p.closureType}|${p.affectedLanes}|${p.closures.map((c) => c.segmentId).join(',')}`;
}

export function analyzeSolo(p: Project, band: number): SoloAnalysis {
  const key = soloKey(p, band);
  const hit = soloCache.get(key);
  if (hit) return hit;
  const base = BASELINE(band);
  const r = assign(combineEffects([{ ...p, coordinationGroup: undefined }]), band);
  const segs = new Set(p.closures.map((c) => c.segmentId));
  const users = new Map<string, number>();
  const detourOnto = new Map<string, number>();
  let displaced = 0;
  const scale = BANDS[band];
  for (const od of OD_PAIRS) {
    const k = odKey(od.oId, od.dId);
    const bp = base.paths.get(k);
    if (!bp || !bp.segIds.some((s) => segs.has(s))) continue;
    const trips = od.trips * scale;
    users.set(k, trips);
    const np = r.paths.get(k);
    if (!np) continue;
    const baseSet = new Set(bp.segIds);
    if (np.segIds.some((s) => segs.has(s)) && np.segIds.length === bp.segIds.length && np.segIds.every((s, i) => s === bp.segIds[i])) continue;
    displaced += trips;
    for (const s of np.segIds) if (!baseSet.has(s)) detourOnto.set(s, (detourOnto.get(s) ?? 0) + trips);
  }
  // Equilibrium flow increases on other links (MSA spreads traffic) — supporting evidence.
  const flowIncrease = new Map<string, number>();
  for (const [segId, f] of r.flowBySeg) {
    if (segs.has(segId)) continue;
    const inc = f - (base.flowBySeg.get(segId) ?? 0);
    if (inc > 0) flowIncrease.set(segId, inc);
  }
  const res: SoloAnalysis = { delay: hourlyDelay(r), displacedTrips: displaced, detourOnto, users, flowIncrease };
  soloCache.set(key, res);
  return res;
}

function segName(id: string) {
  const s = SEGMENT_BY_ID.get(id);
  return s ? s.name : id;
}

function jaccard(a: Map<string, number>, b: Map<string, number>) {
  let inter = 0;
  let union = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    inter += Math.min(x, y);
    union += Math.max(x, y);
  }
  return union > 0 ? inter / union : 0;
}

function midpoint(a: LngLat, b: LngLat): LngLat {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function detectPair(a: Project, b: Project): Conflict | null {
  if (!isSimulated(a) || !isSimulated(b) || a.id === b.id) return null;
  const [p, q] = a.id < b.id ? [a, b] : [b, a];
  const sameGroup = !!p.coordinationGroup && p.coordinationGroup === q.coordinationGroup;
  const dateOv = overlapDays(p.schedule, q.schedule);
  const hrs = hoursOverlap(p, q);
  const temporal = !!dateOv && !!hrs;
  const segP = new Set(p.closures.map((c) => c.segmentId));
  const sharedSegs = q.closures.map((c) => c.segmentId).filter((s) => segP.has(s));
  const distKm = minDistanceKm(p, q);
  const evidence: ConflictEvidence[] = [];
  const matched = new Set<ConflictCategory>();
  let kind: EvidenceKind = 'proximity';
  let interaction = 0;
  let accessDrop = 0;
  const allSegs = [...new Set([...segP, ...q.closures.map((c) => c.segmentId)])];

  if (sameGroup && temporal) return null; // coordinated shared work zone (approved decision)

  if (temporal) {
    const band = criticalBand(hrs!);
    const sp = analyzeSolo(p, band);
    const sq = analyzeSolo(q, band);
    const joint = assign(combineEffects([p, q]), band);
    interaction = hourlyDelay(joint) - sp.delay - sq.delay;
    const timeLbl = `${fmtShort(dateOv!.start)} – ${fmtShort(dateOv!.end)} (${dateOv!.days} يوم)، الساعات ${hrs![0]}:00–${hrs![1]}:00`;

    // A. Direct overlap
    if (sharedSegs.length) {
      matched.add('direct');
      const ovKm = overlapLengthKm(p, q);
      const seg = SEGMENT_BY_ID.get(sharedSegs[0])!;
      const eff = combineEffects([p, q]).get(seg.id);
      if (ovKm > 0.001) {
        kind = 'geometric';
        evidence.push({
          rule: 'direct', kind: 'geometric', value: Math.round(ovKm * 1000), unit: 'م',
          textAr: `تداخل هندسي مؤكد (Turf lineOverlap) بطول ${Math.round(ovKm * 1000)} م على ${segName(seg.id)} خلال ${timeLbl}.`,
          textEn: `Confirmed geometric overlap of ${Math.round(ovKm * 1000)} m on ${seg.nameEn}.`,
        });
      } else {
        kind = 'network';
        evidence.push({
          rule: 'direct', kind: 'network',
          textAr: `المشروعان يغلقان نفس المقطع (${segName(seg.id)}) بامتدادات غير متلاصقة خلال ${timeLbl}؛ المقطع يُعامل كوصلة واحدة في الشبكة.`,
          textEn: `Both close the same block (${seg.nameEn}) with non-touching extents.`,
        });
      }
      if (eff)
        evidence.push({
          rule: 'direct', kind: 'network', value: eff.closedLanes, unit: 'مسار',
          textAr: eff.full
            ? `مجموع المسارات المغلقة يساوي عرض الطريق بالكامل (${seg.lanesPerDirection} مسارات لكل اتجاه) ← إغلاق كلي فعلي.`
            : `عند اجتماع الإغلاقين يُغلق ${eff.closedLanes} من ${seg.lanesPerDirection} مسارات لكل اتجاه.`,
          textEn: `Combined: ${eff.closedLanes}/${seg.lanesPerDirection} lanes closed per direction.`,
        });
    }

    // C. Detour conflict (either direction)
    for (const [x, y, sx] of [
      [p, q, sp],
      [q, p, sq],
    ] as const) {
      let onto = 0;
      let ontoSeg = '';
      for (const c of y.closures) {
        const v = sx.detourOnto.get(c.segmentId) ?? 0;
        if (v > onto) ((onto = v), (ontoSeg = c.segmentId));
      }
      const share = sx.displacedTrips > 0 ? onto / sx.displacedTrips : 0;
      if (onto >= RULES.DETOUR_MIN_VPH || (share >= RULES.DETOUR_MIN_SHARE && onto > 600)) {
        if (sharedSegs.includes(ontoSeg)) continue;
        matched.add('detour');
        if (kind !== 'geometric') kind = 'network';
        evidence.push({
          rule: 'detour', kind: 'network', value: Math.round(onto), unit: 'مركبة/ساعة',
          textAr: `نموذج التوزيع المروري: إغلاق «${x.title}» يحوّل نحو ${Math.round(onto)} مركبة/ساعة إلى ${segName(ontoSeg)}، وهو مقطع يغلقه «${y.title}» في نفس الفترة.`,
          textEn: `Closing ${x.id} diverts ~${Math.round(onto)} veh/h onto a block closed by ${y.id}.`,
        });
      }
    }

    // D. Access disruption
    for (const z of ZONES) {
      const accJ = zoneAccessibility(joint, z.id);
      const accP = zoneAccessibility(assign(combineEffects([p]), band), z.id);
      const accQ = zoneAccessibility(assign(combineEffects([q]), band), z.id);
      const drop = 100 - accJ;
      const extra = Math.min(accP, accQ) - accJ;
      if (drop >= RULES.ACCESS_DROP_POINTS && extra >= RULES.ACCESS_EXTRA_POINTS) {
        matched.add('access');
        if (kind !== 'geometric') kind = 'network';
        accessDrop = Math.max(accessDrop, drop);
        evidence.push({
          rule: 'access', kind: 'network', value: Math.round(accJ), unit: '/100',
          textAr: `مؤشر الوصول إلى ${z.name} ينخفض إلى ${Math.round(accJ)}/100 عند اجتماع الإغلاقين (مقابل ${Math.round(Math.min(accP, accQ))} لكل إغلاق منفرداً).`,
          textEn: `Accessibility of ${z.nameEn} falls to ${Math.round(accJ)}/100 with both closures.`,
        });
      }
    }

    // B. Nearby closures
    if (!sharedSegs.length && distKm <= RULES.NEARBY_KM) {
      const jac = jaccard(sp.users, sq.users);
      matched.add('nearby');
      if (jac >= RULES.MOVEMENT_JACCARD || interaction > 1) {
        if (kind === 'proximity') kind = 'network';
        evidence.push({
          rule: 'nearby', kind: 'network', value: Math.round(jac * 100), unit: '%',
          textAr: `الإغلاقان على بعد ${Math.round(distKm * 1000)} م ويخدمان حركات مرورية مشتركة (تشابه ${Math.round(jac * 100)}% في رحلات المنشأ–الوجهة المتأثرة).`,
          textEn: `Closures ${Math.round(distKm * 1000)} m apart serving overlapping movements (${Math.round(jac * 100)}% OD overlap).`,
        });
      } else {
        evidence.push({
          rule: 'nearby', kind: 'proximity', value: Math.round(distKm * 1000), unit: 'م',
          textAr: `قرب جغرافي فقط (${Math.round(distKm * 1000)} م) دون تداخل مُنمذج في الحركة — تحذير مخاطرة وليس دليلاً على ازدحام.`,
          textEn: `Proximity only (${Math.round(distKm * 1000)} m) — risk warning, not evidence of congestion.`,
        });
      }
    }

    if (matched.size && interaction > 0.5)
      evidence.push({
        rule: [...matched][0], kind: 'network', value: Math.round(interaction), unit: 'مركبة-ساعة',
        textAr: `أثر تفاعلي: التأخير المشترك يزيد بمقدار ${Math.round(interaction)} مركبة-ساعة في ساعة الذروة عن مجموع أثر كل إغلاق منفرداً.`,
        textEn: `Interaction: +${Math.round(interaction)} veh-h per peak hour beyond the sum of individual impacts.`,
      });
  }

  // E. Sequential disruption (no temporal overlap)
  let gap: number | undefined;
  const sameRoad = p.closures.some((c) => q.closures.some((d) => SEGMENT_BY_ID.get(c.segmentId)?.roadId === SEGMENT_BY_ID.get(d.segmentId)?.roadId));
  if (!temporal && !sameGroup && (sharedSegs.length || (sameRoad && distKm <= RULES.SEQUENTIAL_KM))) {
    const g = gapDays(p.schedule, q.schedule);
    const ov = overlapDays(p.schedule, q.schedule);
    const effectiveGap = g >= 0 ? g : ov ? 0 : -1;
    if (effectiveGap >= 0 && effectiveGap <= RULES.SEQUENTIAL_GAP_DAYS) {
      gap = effectiveGap;
      matched.add('sequential');
      kind = 'proximity';
      evidence.push({
        rule: 'sequential', kind: sharedSegs.length ? 'geometric' : 'proximity', value: effectiveGap, unit: 'يوم',
        textAr: ov
          ? `نفس المقطع يُغلق في فترات عمل مختلفة من اليوم ضمن نفس الأيام — فرصة لتوحيد نافذة العمل.`
          : `${sharedSegs.length ? 'نفس المقطع' : 'نفس المنطقة'} (${segName(sharedSegs[0] ?? p.closures[0].segmentId)}) يُغلق مرتين بفاصل ${effectiveGap} يوم فقط — إزعاج متكرر يمكن تقليله بالتنسيق.`,
        textEn: `Same area closed repeatedly with a ${effectiveGap}-day gap.`,
      });
      if (sharedSegs.length) kind = 'geometric';
    }
  }

  if (!matched.size) return null;
  const order: ConflictCategory[] = ['direct', 'detour', 'access', 'nearby', 'sequential'];
  let category = order.find((c) => matched.has(c))!;
  const nearbyOnlyProximity = category === 'nearby' && evidence.every((e) => e.rule !== 'nearby' || e.kind === 'proximity');
  if (nearbyOnlyProximity && !matched.has('detour') && !matched.has('access')) kind = 'proximity';
  if (category === 'nearby' && kind === 'proximity') category = 'nearby';

  // Severity scoring — transparent breakdown
  const breakdown: { label: string; points: number }[] = [];
  const baseByCat: Record<ConflictCategory, number> = { direct: 45, detour: 40, access: 40, nearby: kind === 'proximity' ? 10 : 30, sequential: 20 };
  breakdown.push({ label: `نوع التعارض: ${CATEGORY_AR[category]}`, points: baseByCat[category] });
  if (category === 'direct' && kind === 'geometric') breakdown.push({ label: 'تداخل هندسي مؤكد', points: 10 });
  if (interaction > 0.5) breakdown.push({ label: `أثر مروري تفاعلي (${Math.round(interaction)} مركبة-ساعة/ساعة ذروة)`, points: Math.min(25, Math.round(interaction / 15)) });
  if (dateOv && temporal) breakdown.push({ label: `أيام التداخل (${dateOv.days})`, points: Math.min(15, Math.round(dateOv.days * 0.75)) });
  if (accessDrop > 0) breakdown.push({ label: `انخفاض الوصول (${Math.round(accessDrop)} نقطة)`, points: Math.min(10, Math.round(accessDrop / 2)) });
  if (gap !== undefined) breakdown.push({ label: `تكرار الإغلاق بفاصل ${gap} يوم`, points: Math.min(20, Math.round((RULES.SEQUENTIAL_GAP_DAYS - gap) / 2.5)) });
  if (PRIORITIES[p.priority].rank === 4 || PRIORITIES[q.priority].rank === 4) breakdown.push({ label: 'يتضمن مشروعاً حرجاً', points: 5 });
  const score = Math.min(100, breakdown.reduce((s, b) => s + b.points, 0));
  const severity: Severity = score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low';

  const explanationAr =
    category === 'direct'
      ? `المشروعان يغلقان نفس المقطع (${segName(sharedSegs[0])}) في فترة متداخلة.`
      : category === 'detour'
        ? 'أحد الإغلاقين يقع على المسار البديل الذي تعتمد عليه حركة المرور المحوّلة من الإغلاق الآخر خلال فترة متداخلة.'
        : category === 'access'
          ? 'اجتماع الإغلاقين يقلّل الوصول إلى حي/وجهة مهمة أكثر من أثر كل منهما منفرداً.'
          : category === 'nearby'
            ? kind === 'proximity'
              ? 'إغلاقان متقاربان جغرافياً في نفس الفترة؛ لا يُظهر النموذج تداخلاً مرورياً جوهرياً (تحذير فقط).'
              : 'إغلاقان متجاوران في نفس الفترة يخدمان حركات مرورية مشتركة.'
            : 'نفس الموقع سيُغلق أكثر من مرة خلال فترة قصيرة؛ التنسيق يقلل أيام الإزعاج.';

  return {
    id: `C-${p.id}-${q.id}`,
    projectIds: [p.id, q.id],
    category,
    kind,
    severity,
    score,
    overlap: temporal ? dateOv : null,
    gapDays: gap,
    segmentIds: allSegs,
    evidence,
    scoreBreakdown: breakdown,
    explanationAr,
    location: midpoint(projectMidpoint(p), projectMidpoint(q)),
  };
}

export function detectConflicts(projects: Project[]): Conflict[] {
  const list = projects.filter(isSimulated);
  const out: Conflict[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const c = detectPair(list[i], list[j]);
      if (c) out.push(c);
    }
  return out.sort((a, b) => b.score - a.score);
}

export function conflictsForProject(conflicts: Conflict[], id: string) {
  return conflicts.filter((c) => c.projectIds.includes(id));
}
