/**
 * Property-based checks with seeded random projects — verifies behaviour, not appearance.
 */
import { describe, expect, it } from 'vitest';
import type { Project } from '@/types';
import { CLOSABLE_SEGMENTS, SEGMENT_BY_ID } from '@/data/network';
import { createSeedProjects } from '@/data/projects';
import { detectPair, detectConflicts } from '@/engine/conflicts/detect';
import { applyChanges, generateOptions } from '@/engine/optimization/optimize';
import { assign, BASELINE, hourlyDelay, totalVehHours } from '@/engine/traffic/assignment';
import { combineEffects } from '@/engine/traffic/effects';
import { closureOutcomes } from '@/engine/traffic/simulate';
import { planJourney } from '@/engine/routing/journey';
import { mulberry32 } from '@/utils/random';
import { dayIndex, durationDays, isoFromDay } from '@/utils/date';

const ORGS = ['municipality', 'water', 'electricity', 'telecom', 'roads'] as const;
const CATS = ['water', 'electricity', 'telecom', 'road_maintenance', 'municipal', 'drainage'] as const;
const PRI = ['critical', 'high', 'medium', 'low'] as const;

function randomProject(rnd: () => number, i: number): Project {
  const seg = CLOSABLE_SEGMENTS[Math.floor(rnd() * CLOSABLE_SEGMENTS.length)];
  const a = rnd() * 0.6;
  const start = Math.floor(rnd() * 60);
  const dur = 3 + Math.floor(rnd() * 20);
  const full = rnd() < 0.25;
  const hours = rnd() < 0.6 ? { start: 0, end: 24 } : rnd() < 0.5 ? { start: 0, end: 6 } : { start: 8, end: 18 };
  const sched = { start: isoFromDay(start), end: isoFromDay(start + dur - 1) };
  return {
    id: `F-${i}`,
    title: `fuzz ${i}`,
    orgId: ORGS[Math.floor(rnd() * 5)],
    category: CATS[Math.floor(rnd() * 6)],
    closures: [{ segmentId: seg.id, from: a, to: a + 0.1 + rnd() * 0.3 }],
    proposed: sched,
    schedule: sched,
    workHours: hours,
    priority: PRI[Math.floor(rnd() * 4)],
    earliestStart: isoFromDay(Math.max(0, start - Math.floor(rnd() * 15))),
    latestEnd: isoFromDay(Math.min(91, start + dur - 1 + Math.floor(rnd() * 30))),
    closureType: full ? 'full' : 'partial',
    affectedLanes: full ? seg.lanesPerDirection : Math.max(1, Math.min(seg.lanesPerDirection - 1, 1 + Math.floor(rnd() * 2))),
    estimatedCostSar: 1e6,
    status: 'submitted',
    neighborhood: 'x',
    createdAt: '2026-11-01T00:00:00Z',
    synthetic: true,
  };
}

describe('conflict engine properties (60 random pairs)', () => {
  const rnd = mulberry32(99);
  const pairs = Array.from({ length: 60 }, (_, i) => [randomProject(rnd, 2 * i), randomProject(rnd, 2 * i + 1)] as const);

  it('is symmetric and deterministic', () => {
    for (const [a, b] of pairs) {
      const x = detectPair(a, b);
      const y = detectPair(b, a);
      expect(x?.id ?? null).toBe(y?.id ?? null);
      expect(x?.score ?? null).toBe(y?.score ?? null);
      expect(JSON.stringify(detectPair(a, b))).toBe(JSON.stringify(x));
    }
  });

  it('a direct conflict always means same segment + overlapping dates and hours', () => {
    for (const [a, b] of pairs) {
      const c = detectPair(a, b);
      if (c?.category !== 'direct') continue;
      expect(a.closures[0].segmentId).toBe(b.closures[0].segmentId);
      expect(c.overlap).not.toBeNull();
      expect(Math.max(a.workHours.start, b.workHours.start)).toBeLessThan(Math.min(a.workHours.end, b.workHours.end));
    }
  });

  it('projects far apart in time never produce a temporal conflict', () => {
    for (const [a] of pairs) {
      const far = { ...a, id: 'F-far', closures: a.closures, schedule: { start: isoFromDay(dayIndex(a.schedule.end) + 50), end: isoFromDay(dayIndex(a.schedule.end) + 52) } };
      if (dayIndex(far.schedule.end) > 91) continue;
      const c = detectPair(a, far);
      expect(c?.overlap ?? null).toBeNull();
      if (c) expect(c.category).toBe('sequential');
    }
  });

  it('severity always matches its score thresholds and evidence is never empty', () => {
    for (const [a, b] of pairs) {
      const c = detectPair(a, b);
      if (!c) continue;
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
      expect(c.severity).toBe(c.score >= 65 ? 'high' : c.score >= 40 ? 'medium' : 'low');
    }
  });
});

describe('optimizer properties on random conflicts', () => {
  it('feasible options always respect windows, keep durations, and never auto-recommend a shared window', () => {
    const rnd = mulberry32(7);
    const base = createSeedProjects();
    let checked = 0;
    for (let i = 0; i < 25 && checked < 8; i++) {
      const a = randomProject(rnd, 500 + i);
      const all = [...base, a];
      const c = detectConflicts(all).find((x) => x.projectIds.includes(a.id) && x.kind !== 'proximity');
      if (!c) continue;
      checked++;
      const r = generateOptions(c, all);
      expect(r.options).toHaveLength(3);
      for (const o of r.options) {
        if (o.kind === 'coordinated') expect(o.recommended).toBe(false);
        if (!o.feasible) {
          expect(o.infeasibleReasonAr).toBeTruthy();
          continue;
        }
        for (const ch of o.changes) {
          const p = all.find((x) => x.id === ch.projectId)!;
          expect(dayIndex(ch.to.start)).toBeGreaterThanOrEqual(dayIndex(p.earliestStart));
          expect(dayIndex(ch.to.end)).toBeLessThanOrEqual(dayIndex(p.latestEnd));
          expect(durationDays(ch.to)).toBe(durationDays(p.schedule));
        }
        // earlier/delay must actually separate the conflicting pair in time
        if (o.kind !== 'coordinated') {
          const after = applyChanges(all, o.changes);
          const [p, q] = c.projectIds.map((id) => after.find((x) => x.id === id)!);
          const overlap = Math.max(dayIndex(p.schedule.start), dayIndex(q.schedule.start)) <= Math.min(dayIndex(p.schedule.end), dayIndex(q.schedule.end));
          expect(overlap).toBe(false);
        }
      }
      expect(r.options.filter((o) => o.recommended).length).toBeLessThanOrEqual(1);
    }
    expect(checked).toBeGreaterThan(3);
  });
});

describe('traffic & routing properties', () => {
  it('closing any block never makes the network meaningfully faster (no free lunch, incl. unserved trips)', () => {
    const base = BASELINE(3).sysVehHours;
    for (const s of CLOSABLE_SEGMENTS) {
      const r = assign(combineEffects([{ ...randomProject(mulberry32(1), 0), closures: [{ segmentId: s.id, from: 0, to: 1 }], closureType: 'full', affectedLanes: s.lanesPerDirection }]), 3);
      // allow ≤0.5 % equilibrium-approximation noise, never a real "saving"
      expect(totalVehHours(r), s.id).toBeGreaterThan(base * 0.995);
      expect(hourlyDelay(r)).toBeGreaterThanOrEqual(0);
    }
  });

  it('a citizen route never uses a fully closed block, and the published closure is reported', () => {
    const p = { ...createSeedProjects().find((x) => x.id === 'RASD-P04')!, status: 'approved' as const };
    const plan = planJourney([p], 'Z-OLAYA-MID', 'G-OLY-S', '2027-01-14', 10, false);
    expect(plan.now).not.toBeNull();
    expect(plan.now!.segIds).not.toContain('OLY-MAK-THL');
    expect(plan.now!.timeMin).toBeGreaterThanOrEqual(plan.normal!.timeMin - 1e-9);
    // outside working hours (07–19) the road is open again
    expect(planJourney([p], 'Z-OLAYA-MID', 'G-OLY-S', '2027-01-14', 22, false).affecting).toHaveLength(0);
  });

  it('outcome metrics: coordinating the same block never increases closure episodes', () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 20; i++) {
      const a = randomProject(rnd, 900 + i);
      const b = { ...randomProject(rnd, 950 + i), closures: a.closures };
      const sep = closureOutcomes([a, b]);
      const shared = closureOutcomes([a, { ...b, schedule: { start: a.schedule.start, end: isoFromDay(dayIndex(a.schedule.start) + durationDays(b.schedule) - 1) } }]);
      expect(shared.closureEpisodes).toBeLessThanOrEqual(sep.closureEpisodes);
      expect(SEGMENT_BY_ID.has(a.closures[0].segmentId)).toBe(true);
    }
  });
});
