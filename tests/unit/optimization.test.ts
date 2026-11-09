import { describe, expect, it } from 'vitest';
import { createSeedProjects } from '@/data/projects';
import { detectPair } from '@/engine/conflicts/detect';
import { applyChanges, DEFAULT_WEIGHTS, generateOptions, rankOptions } from '@/engine/optimization/optimize';
import { dayIndex, durationDays } from '@/utils/date';

const ps = createSeedProjects();
const P = (id: string) => ps.find((p) => p.id === id)!;

describe('schedule optimization', () => {
  it('always returns the three option families with explanations', () => {
    const c = detectPair(P('RASD-P01'), P('RASD-P02'))!;
    const r = generateOptions(c, ps);
    expect(r.options.map((o) => o.kind)).toEqual(['earlier', 'delay', 'coordinated']);
    for (const o of r.options) {
      if (o.feasible) expect(o.metrics).not.toBeNull();
      else expect(o.infeasibleReasonAr!.length).toBeGreaterThan(10);
    }
  });
  it('uses the three official alternative names', () => {
    const c = detectPair(P('RASD-P01'), P('RASD-P02'))!;
    expect(generateOptions(c, ps).options.map((o) => o.titleAr)).toEqual(['تقديم الموعد حسب المرونة', 'تأخير الموعد حسب الأولوية', 'نافذة مشتركة إذا أمكن فنيًا']);
  });
  it('S1: a shared work zone is feasible (fewer lanes closed → less modeled delay) but NEVER auto-recommended', () => {
    const c = detectPair(P('RASD-P01'), P('RASD-P02'))!;
    const r = generateOptions(c, ps);
    const co = r.options.find((o) => o.kind === 'coordinated')!;
    expect(co.feasible).toBe(true);
    expect(co.recommended).toBe(false);
    expect(co.requiresTechnicalConfirmation).toBe(true);
    expect(co.metrics!.closureKmDays).toBeLessThanOrEqual(r.current.closureKmDays + 1e-9);
    expect(co.metrics!.vehicleHoursDelay).toBeLessThan(r.current.vehicleHoursDelay);
    const rec = r.options.find((o) => o.recommended);
    if (rec) expect(rec.kind).not.toBe('coordinated');
  });
  it('S4: critical project cannot move; earlier is infeasible, coordinated incompatible, delay feasible', () => {
    const c = detectPair(P('RASD-P08'), P('RASD-P09'))!;
    const r = generateOptions(c, ps);
    const [earlier, delay, co] = r.options;
    expect(earlier.feasible).toBe(false);
    expect(co.feasible).toBe(false);
    expect(delay.feasible).toBe(true);
    expect(delay.changes[0].projectId).toBe('RASD-P09');
    expect(delay.recommended).toBe(true);
  });
  it('S2: coordinated execution on different blocks is rejected as unsafe for the network', () => {
    const c = detectPair(P('RASD-P03'), P('RASD-P04'))!;
    const co = generateOptions(c, ps).options.find((o) => o.kind === 'coordinated')!;
    expect(co.feasible).toBe(false);
  });
  it('feasible options never violate flexibility windows', () => {
    for (const [a, b] of [
      ['RASD-P01', 'RASD-P02'],
      ['RASD-P03', 'RASD-P04'],
      ['RASD-P05', 'RASD-P06'],
      ['RASD-P08', 'RASD-P09'],
    ]) {
      const c = detectPair(P(a), P(b))!;
      for (const o of generateOptions(c, ps).options.filter((x) => x.feasible))
        for (const ch of o.changes) {
          const p = P(ch.projectId);
          expect(dayIndex(ch.to.start)).toBeGreaterThanOrEqual(dayIndex(p.earliestStart));
          expect(dayIndex(ch.to.end)).toBeLessThanOrEqual(dayIndex(p.latestEnd));
          expect(durationDays(ch.to)).toBe(durationDays(p.schedule));
        }
    }
  });
  it('S3: shared window groups all three utilities and cuts repeated closures of Al Urubah Rd', () => {
    const c = detectPair(P('RASD-P05'), P('RASD-P06'))!;
    const r = generateOptions(c, ps);
    const co = r.options.find((o) => o.kind === 'coordinated')!;
    expect(co.feasible).toBe(true);
    expect(co.changes.map((x) => x.projectId).sort()).toEqual(['RASD-P05', 'RASD-P06', 'RASD-P07']);
    expect(co.metrics!.closureEpisodes).toBe(r.current.closureEpisodes - 2);
    expect(co.metrics!.repeatedClosures).toBe(r.current.repeatedClosures - 2);
  });
  it('ranking responds to weights (transparent weighted score)', () => {
    const c = detectPair(P('RASD-P05'), P('RASD-P06'))!;
    const r = generateOptions(c, ps);
    const shiftOnly = rankOptions(r.options.map((o) => ({ ...o })), r.current, { conflicts: 0, repeat: 0, delay: 0, closureDays: 0, detour: 0, accessibility: 0, shift: 50 });
    const best = shiftOnly.find((o) => o.recommended)!;
    const minShift = Math.min(...shiftOnly.filter((o) => o.feasible && o.kind !== 'coordinated').map((o) => o.shiftDays));
    expect(best.shiftDays).toBe(minShift);
    const def = rankOptions(r.options.map((o) => ({ ...o })), r.current, DEFAULT_WEIGHTS);
    expect(def.filter((o) => o.recommended)).toHaveLength(1);
  });
  it('applying an option updates schedules and coordination groups', () => {
    const c = detectPair(P('RASD-P01'), P('RASD-P02'))!;
    const co = generateOptions(c, ps).options.find((o) => o.kind === 'coordinated')!;
    const after = applyChanges(ps, co.changes);
    const a = after.find((p) => p.id === 'RASD-P01')!;
    expect(a.schedule).toEqual(co.changes.find((x) => x.projectId === 'RASD-P01')!.to);
    expect(a.coordinationGroup).toBeDefined();
    expect(detectPair(a, after.find((p) => p.id === 'RASD-P02')!)).toBeNull();
  });
});

describe('slot search', () => {
  it('delay picks the closest slot in the window that introduces no new conflict when one exists', async () => {
    const { createDemoConflictProject } = await import('@/data/projects');
    const { detectConflicts } = await import('@/engine/conflicts/detect');
    const all = [...ps, createDemoConflictProject()];
    const c = detectPair(all.find((p) => p.id === 'RASD-P01')!, all.find((p) => p.id === 'RASD-D01')!)!;
    const r = generateOptions(c, all);
    const delay = r.options.find((o) => o.kind === 'delay')!;
    expect(delay.feasible).toBe(true);
    expect(delay.recommended).toBe(true);
    const after = applyChanges(all, delay.changes);
    const act = (l: ReturnType<typeof detectConflicts>) => l.filter((x) => x.kind !== 'proximity' || x.category === 'sequential');
    expect(act(detectConflicts(after)).some((x) => x.id === c.id)).toBe(false);
    expect(act(detectConflicts(after)).length).toBeLessThan(act(detectConflicts(all)).length);
  });
});
