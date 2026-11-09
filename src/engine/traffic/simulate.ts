import type { DailyMetric, EconomicAssumptions, Project, ScenarioMetrics } from '@/types';
import { HORIZON_DAYS, isoFromDay } from '@/utils/date';
import { accessibilityScore, assign, bandOfHour, hourlyDelay, hourlyDetourKm } from './assignment';
import { effectsAt, effectsKey, isActiveOnDay, isSimulated } from './effects';
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
