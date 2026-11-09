import { describe, expect, it } from 'vitest';
import { assign, accessibilityScore, BASELINE, hourlyDelay, OD_PAIRS, TARGET_PEAK_VC } from '@/engine/traffic/assignment';
import { combineEffects, effectsAt } from '@/engine/traffic/effects';
import { simulateSchedule } from '@/engine/traffic/simulate';
import { vehiclePositions, vehicleSet } from '@/engine/traffic/vehicles';
import { createSeedProjects } from '@/data/projects';
import { dayIndex } from '@/utils/date';
import { economicCost, DEFAULT_ECONOMICS } from '@/engine/economics/economics';

const ps = createSeedProjects();
const P = (id: string) => ps.find((p) => p.id === id)!;

describe('traffic assignment', () => {
  it('calibrates the no-closure peak hour to the target V/C', () => {
    expect(OD_PAIRS.length).toBeGreaterThan(100);
    expect(BASELINE(3).maxVc).toBeCloseTo(TARGET_PEAK_VC, 1);
    expect(hourlyDelay(BASELINE(3))).toBe(0);
    expect(accessibilityScore(BASELINE(3))).toBeCloseTo(100, 5);
  });
  it('is deterministic', () => {
    const a = assign(combineEffects([P('RASD-P01')]), 3);
    expect(a.sysVehHours).toBeGreaterThan(BASELINE(3).sysVehHours);
    const again = assign(combineEffects([{ ...P('RASD-P01') }]), 3);
    expect(again.sysVehHours).toBe(a.sysVehHours);
  });
  it('removes fully closed links and reroutes traffic', () => {
    const full = { ...P('RASD-P04') };
    const r = assign(combineEffects([full]), 3);
    expect(r.vcBySeg.get('OLY-URB-KAR')).toBe(Infinity);
    for (const p of r.paths.values()) if (p) expect(p.segIds).not.toContain('OLY-URB-KAR');
    expect(hourlyDelay(r)).toBeGreaterThan(0);
  });
  it('sums independent lane closures but shares a coordinated work zone', () => {
    const a = P('RASD-P01');
    const b = P('RASD-P02');
    expect(combineEffects([a, b]).get('KFR-THL-URB')!.closedLanes).toBe(4);
    const shared = combineEffects([{ ...a, coordinationGroup: 'g' }, { ...b, coordinationGroup: 'g' }]);
    expect(shared.get('KFR-THL-URB')!.closedLanes).toBe(2);
  });
  it('respects working hours', () => {
    const night = P('RASD-P13'); // 00–06
    const d = dayIndex('2027-01-16');
    expect(effectsAt([night], d, 3).size).toBe(1);
    expect(effectsAt([night], d, 8).size).toBe(0);
  });
  it('simulates the horizon and yields consistent totals', () => {
    const m = simulateSchedule(ps);
    expect(m.daily).toHaveLength(92);
    expect(m.vehicleHoursDelay).toBeCloseTo(m.daily.reduce((s, d) => s + d.vehicleHoursDelay, 0), 6);
    expect(m.closureDays).toBeGreaterThan(30);
    expect(m.accessibilityScore).toBeGreaterThan(0);
    expect(m.accessibilityScore).toBeLessThanOrEqual(100);
    expect(simulateSchedule([]).vehicleHoursDelay).toBe(0);
  });
  it('produces deterministic vehicle positions (video frame-safe)', () => {
    const set = vehicleSet(assign(combineEffects([P('RASD-P01')]), 3), 50, 3);
    expect(vehiclePositions(set, 12.5)).toEqual(vehiclePositions(set, 12.5));
    expect(vehiclePositions(set, 12.5).length).toBeGreaterThan(40);
  });
});

describe('economics', () => {
  it('applies the documented formula', () => {
    const r = economicCost(1000, 2000, DEFAULT_ECONOMICS);
    expect(r.delayCost).toBeCloseTo(1000 * 1.3 * 45);
    expect(r.operatingCost).toBeCloseTo(2000 * 0.55);
    expect(economicCost(1000, 2000, { ...DEFAULT_ECONOMICS, includeOperatingCost: false }).operatingCost).toBe(0);
  });
});

import { closureOutcomes } from '@/engine/traffic/simulate';
describe('official RASD outcome metrics', () => {
  it('counts closure episodes, repeated closures, km-days and published share', () => {
    const urubah = ['RASD-P05', 'RASD-P06', 'RASD-P07'].map(P);
    const o = closureOutcomes(urubah);
    expect(o.closureEpisodes).toBe(3);
    expect(o.repeatedClosures).toBe(2);
    expect(o.closureKmDays).toBeGreaterThan(0);
    expect(o.visibleClosureShare).toBe(0); // nothing approved yet → nothing published to road users
    const published = closureOutcomes(urubah.map((p) => ({ ...p, status: 'approved' as const })));
    expect(published.visibleClosureShare).toBeCloseTo(100, 6);
  });
});
