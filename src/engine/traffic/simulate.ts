import type { DailyMetric, EconomicAssumptions, Project, ScenarioMetrics } from '@/types';
import { HORIZON_DAYS, isoFromDay } from '@/utils/date';
import { accessibilityScore, assign, bandOfHour, hourlyDelay, hourlyDetourKm } from './assignment';
import { effectsAt, effectsKey, isActiveOnDay, isSimulated } from './effects';
import { SEGMENT_BY_ID } from '@/data/network';
import { economicCost, DEFAULT_ECONOMICS } from '@/engine/economics/economics';

export interface SimulationOptions {
  startDay?: number;
  endDay?: number;
  economics?: EconomicAssumptions;
}

/**
 * Simulate every hour of the horizon for a given schedule of projects.
 * Returns network metrics (conflict counts are filled in by the caller).
 */
export function simulateSchedule(projects: Project[], opts: SimulationOptions = {}): Omit<ScenarioMetrics, 'conflicts' | 'highConflicts'> {
  const closure = closureOutcomes(projects, opts.startDay ?? 0, opts.endDay ?? HORIZON_DAYS - 1);
  const sim = projects.filter(isSimulated);
  const start = opts.startDay ?? 0;
  const end = opts.endDay ?? HORIZON_DAYS - 1;
  const daily: DailyMetric[] = [];
  let vhd = 0;
  let detour = 0;
  let segDays = 0;
  let closureDays = 0;
  let maxVc = 0;
  const accDays: number[] = [];

  for (let d = start; d <= end; d++) {
    const today = sim.filter((p) => isActiveOnDay(p, d));
    let dDelay = 0;
    let dDetour = 0;
    let dAcc = 100;
    const segs = new Set<string>();
    if (today.length) {
      const seenAcc = new Set<string>();
      for (let h = 0; h < 24; h++) {
        const eff = effectsAt(today, d, h);
        const band = bandOfHour(h);
        const r = assign(eff, band);
        maxVc = Math.max(maxVc, r.maxVc);
        if (eff.size === 0) continue;
        for (const k of eff.keys()) segs.add(k);
        dDelay += hourlyDelay(r);
        dDetour += hourlyDetourKm(r);
        // Accessibility evaluated for each distinct closure state at its own demand band.
        const ak = `${band}|${effectsKey(eff)}`;
        if (!seenAcc.has(ak) && band >= 2) {
          seenAcc.add(ak);
          dAcc = Math.min(dAcc, accessibilityScore(r));
        }
      }
    } else {
      maxVc = Math.max(maxVc, assign(new Map(), 3).maxVc);
    }
    if (segs.size) {
      closureDays++;
      segDays += segs.size;
      accDays.push(dAcc);
    }
    vhd += dDelay;
    detour += dDetour;
    daily.push({
      day: d,
      date: isoFromDay(d),
      activeProjects: today.length,
      closedSegments: segs.size,
      vehicleHoursDelay: dDelay,
      detourVehicleKm: dDetour,
      accessibility: dAcc,
    });
  }
  const accessibilityScoreMean = accDays.length ? accDays.reduce((a, b) => a + b, 0) / accDays.length : 100;
  const economics = opts.economics ?? DEFAULT_ECONOMICS;
  return {
    ...closure,
    closureSegmentDays: segDays,
    closureDays,
    vehicleHoursDelay: vhd,
    detourVehicleKm: detour,
    accessibilityScore: accessibilityScoreMean,
    worstAccessibility: accDays.length ? Math.min(...accDays) : 100,
    maxVc,
    economicCostSar: economicCost(vhd, detour, economics).total,
    daily,
  };
}

/** Snapshot of the network at a specific simulated moment. */
export function snapshotAt(projects: Project[], day: number, hour: number) {
  const eff = effectsAt(projects, day, hour);
  return { effects: eff, result: assign(eff, bandOfHour(hour)) };
}

/**
 * Official RASD outcome metrics (closure-level, independent of the traffic model):
 *  - closureEpisodes: number of separate times a block is closed (a block closed, reopened
 *    and closed again counts twice) → "إغلاقات أقل تكراراً"
 *  - closureKmDays: closed road length × days (union of extents per block) → duration & extent
 *  - visibleClosureShare: share of closure km-days that belong to approved/scheduled projects,
 *    i.e. published to road users before the day of travel → "استعداد أفضل لمستخدم الطريق"
 */
export function closureOutcomes(projects: Project[], start = 0, end = HORIZON_DAYS - 1) {
  const sim = projects.filter(isSimulated);
  let episodes = 0;
  let repeated = 0;
  let kmDays = 0;
  let visibleKmDays = 0;
  const segs = new Set(sim.flatMap((p) => p.closures.map((c) => c.segmentId)));
  for (const segId of segs) {
    const seg = SEGMENT_BY_ID.get(segId)!;
    let prev = false;
    let segEpisodes = 0;
    for (let d = start; d <= end; d++) {
      const act = sim.filter((p) => isActiveOnDay(p, d) && p.closures.some((c) => c.segmentId === segId));
      const on = act.length > 0;
      if (on && !prev) segEpisodes++;
      prev = on;
      if (!on) continue;
      const len = unionLength(act.flatMap((p) => p.closures.filter((c) => c.segmentId === segId).map((c) => [Math.min(c.from, c.to), Math.max(c.from, c.to)] as [number, number]))) * seg.lengthKm;
      kmDays += len;
      const vis = act.filter((p) => p.status === 'approved' || p.status === 'scheduled');
      visibleKmDays += unionLength(vis.flatMap((p) => p.closures.filter((c) => c.segmentId === segId).map((c) => [Math.min(c.from, c.to), Math.max(c.from, c.to)] as [number, number]))) * seg.lengthKm;
    }
    episodes += segEpisodes;
    repeated += Math.max(0, segEpisodes - 1);
  }
  return { closureEpisodes: episodes, repeatedClosures: repeated, closureKmDays: kmDays, visibleClosureShare: kmDays > 0 ? (visibleKmDays / kmDays) * 100 : 100 };
}

function unionLength(iv: [number, number][]): number {
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of s) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}
