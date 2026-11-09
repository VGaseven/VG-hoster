import { describe, expect, it } from 'vitest';
import { DEMO_EXCAVATIONS, LocalDemoSource } from '@/twin/adapter';
import { detectTwinConflicts, metricsFor, recommend } from '@/twin/model';
import { TWIN_BLOCKS, TWIN_ROADS } from '@/twin/layout';

const [A, B] = DEMO_EXCAVATIONS;

describe('5-block 3D prototype model (DEMO DATA)', () => {
  it('scope: 5 blocks, one arterial, one overpass, stable segment ids', () => {
    expect(TWIN_BLOCKS).toHaveLength(5);
    expect(TWIN_ROADS.filter((r) => r.kind === 'arterial').length).toBeGreaterThan(0);
    expect(TWIN_ROADS.filter((r) => r.kind === 'bridge')).toHaveLength(1);
    expect(new Set(TWIN_ROADS.map((r) => r.id)).size).toBe(TWIN_ROADS.length);
  });
  it('excavation A slows the corridor; A+B is a detected detour conflict that worsens it', () => {
    const n = metricsFor([], []);
    const a = metricsFor([A], []);
    const c = detectTwinConflicts([A, B]);
    const ab = metricsFor([A, B], c);
    expect(a.corridorTripMin).toBeGreaterThan(n.corridorTripMin);
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe('detour');
    expect(c[0].divertedVehPerHour).toBeGreaterThan(300);
    expect(ab.delayVehHours).toBeGreaterThan(a.delayVehHours);
    expect(detectTwinConflicts([A])).toHaveLength(0);
  });
  it('recommendation reschedules the flexible project within its window and removes the conflict', () => {
    const c = detectTwinConflicts([A, B])[0];
    const r = recommend([A, B], c);
    expect(r.projectId).toBe('EXC-B');
    expect(r.feasible).toBe(true);
    expect(r.to.start > A.end).toBe(true);
    expect(r.to.end <= B.latestEnd).toBe(true);
    expect(detectTwinConflicts([A, { ...B, start: r.to.start, end: r.to.end }])).toHaveLength(0);
  });
  it('demo data source is labelled synthetic and returns the shared road ids', async () => {
    const s = new LocalDemoSource();
    expect(s.synthetic).toBe(true);
    expect((await s.loadRoads()).map((r) => r.id)).toEqual(TWIN_ROADS.map((r) => r.id));
  });
});
