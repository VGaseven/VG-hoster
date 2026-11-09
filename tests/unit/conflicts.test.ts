import { describe, expect, it } from 'vitest';
import { createDemoConflictProject, createSeedProjects } from '@/data/projects';
import { detectConflicts, detectPair } from '@/engine/conflicts/detect';
import { minDistanceKm, overlapLengthKm, snapToSegment, closureLengthKm } from '@/engine/spatial/geometry';
import { SEGMENT_BY_ID } from '@/data/network';

const ps = createSeedProjects();
const P = (id: string) => ps.find((p) => p.id === id)!;
const pair = (a: string, b: string) => detectPair(P(a), P(b));

describe('spatial analysis (Turf)', () => {
  it('measures closure lengths and confirmed geometric overlap', () => {
    const seg = SEGMENT_BY_ID.get('KFR-THL-URB')!;
    expect(closureLengthKm(P('RASD-P01'))).toBeCloseTo(seg.lengthKm * 0.5, 2);
    // P01 0.20–0.70 and P02 0.45–0.95 → 25% of the block
    expect(overlapLengthKm(P('RASD-P01'), P('RASD-P02'))).toBeCloseTo(seg.lengthKm * 0.25, 2);
    expect(overlapLengthKm(P('RASD-P01'), P('RASD-P03'))).toBe(0);
    expect(minDistanceKm(P('RASD-P01'), P('RASD-P02'))).toBe(0);
  });
  it('snaps clicks to the nearest road segment', () => {
    const seg = SEGMENT_BY_ID.get('OLY-THL-URB')!;
    const mid: [number, number] = [(seg.coords[0][0] + seg.coords[1][0]) / 2, (seg.coords[0][1] + seg.coords[1][1]) / 2];
    const s = snapToSegment(mid);
    expect(s?.segmentId).toBe('OLY-THL-URB');
    expect(s!.fraction).toBeCloseTo(0.5, 1);
    expect(snapToSegment([46.9, 24.9])).toBeNull();
  });
});

describe('conflict detection engine', () => {
  it('Scenario 1 — direct overlap is a confirmed geometric conflict', () => {
    const c = pair('RASD-P01', 'RASD-P02')!;
    expect(c.category).toBe('direct');
    expect(c.kind).toBe('geometric');
    expect(c.overlap).toEqual({ start: '2026-12-15', end: '2026-12-24', days: 10 });
    expect(c.evidence.some((e) => e.kind === 'geometric')).toBe(true);
  });
  it('Scenario 2 — closure on another project’s detour is a modeled network conflict', () => {
    const c = pair('RASD-P03', 'RASD-P04')!;
    expect(c.category).toBe('detour');
    expect(c.kind).toBe('network');
    expect(c.evidence.find((e) => e.rule === 'detour')!.value!).toBeGreaterThan(0);
  });
  it('Scenario 3 — repeated closures of the same block are sequential disruption', () => {
    for (const [a, b] of [
      ['RASD-P05', 'RASD-P06'],
      ['RASD-P06', 'RASD-P07'],
      ['RASD-P05', 'RASD-P07'],
    ]) {
      const c = pair(a, b)!;
      expect(c.category).toBe('sequential');
      expect(c.overlap).toBeNull();
      expect(c.gapDays).toBeGreaterThanOrEqual(0);
    }
  });
  it('Scenario 4 — critical project overlap is high severity with explanation', () => {
    const c = pair('RASD-P08', 'RASD-P09')!;
    expect(c.category).toBe('direct');
    expect(c.severity).toBe('high');
    expect(c.scoreBreakdown.some((b) => b.label.includes('حرج'))).toBe(true);
    expect(c.score).toBe(c.scoreBreakdown.reduce((s, b) => Math.min(100, s + b.points), 0));
  });
  it('does not treat proximity alone as proof of congestion', () => {
    const prox = detectConflicts(ps).filter((c) => c.kind === 'proximity' && c.category === 'nearby');
    for (const c of prox) expect(c.severity).toBe('low');
  });
  it('separating closures in time removes the direct conflict', () => {
    const b = { ...P('RASD-P02'), schedule: { start: '2027-01-20', end: '2027-02-10' } };
    const c = detectPair(P('RASD-P01'), b);
    expect(c?.category ?? 'none').not.toBe('direct');
  });
  it('non-overlapping working hours are not a temporal overlap', () => {
    const night = { ...P('RASD-P02'), workHours: { start: 0, end: 6 } };
    const day = { ...P('RASD-P01'), workHours: { start: 8, end: 18 } };
    expect(detectPair(night, day)?.overlap ?? null).toBeNull();
  });
  it('a coordinated shared work zone is not reported as a conflict', () => {
    const a = { ...P('RASD-P01'), coordinationGroup: 'CG' };
    const b = { ...P('RASD-P02'), coordinationGroup: 'CG' };
    expect(detectPair(a, b)).toBeNull();
  });
  it('independent works produce no actionable conflicts', () => {
    for (const id of ['RASD-P10', 'RASD-P11', 'RASD-P12', 'RASD-P13'])
      expect(detectConflicts(ps).filter((c) => c.projectIds.includes(id) && c.kind !== 'proximity')).toHaveLength(0);
  });
  it('the injected demo project conflicts with Project A through the detour', () => {
    const d = createDemoConflictProject();
    const c = detectPair(P('RASD-P01'), d)!;
    expect(c).not.toBeNull();
    expect(['detour', 'nearby', 'access']).toContain(c.category);
    expect(c.kind).toBe('network');
  });
});
