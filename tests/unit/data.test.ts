import { describe, expect, it } from 'vitest';
import { createSeedProjects, SCENARIOS, CITIZEN_JOURNEYS, PLACES } from '@/data/projects';
import { ORGANIZATIONS } from '@/data/organizations';
import { SEGMENT_BY_ID, NODES, SEGMENTS, ZONES, NODE_BY_ID } from '@/data/network';
import { dayIndex, HORIZON_DAYS } from '@/utils/date';

describe('demonstration dataset', () => {
  const ps = createSeedProjects();
  it('meets the minimum size requirements', () => {
    expect(ps.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ps.map((p) => p.orgId)).size).toBeGreaterThanOrEqual(5);
    expect(Object.keys(ORGANIZATIONS)).toHaveLength(5);
    expect(new Set(ps.map((p) => p.neighborhood)).size).toBeGreaterThanOrEqual(3);
    expect(ZONES.length).toBeGreaterThanOrEqual(3);
    expect(SCENARIOS).toHaveLength(4);
    expect(CITIZEN_JOURNEYS).toHaveLength(2);
  });
  it('is reproducible with the fixed seed', () => {
    expect(createSeedProjects()).toEqual(createSeedProjects());
  });
  it('is internally consistent (segments, dates, windows) and clearly synthetic', () => {
    for (const p of ps) {
      expect(p.synthetic).toBe(true);
      for (const c of p.closures) {
        const seg = SEGMENT_BY_ID.get(c.segmentId);
        expect(seg, `${p.id} ${c.segmentId}`).toBeDefined();
        expect(seg!.closable).toBe(true);
        expect(c.from).toBeLessThan(c.to);
      }
      expect(dayIndex(p.schedule.start)).toBeGreaterThanOrEqual(0);
      expect(dayIndex(p.schedule.end)).toBeLessThan(HORIZON_DAYS);
      expect(dayIndex(p.earliestStart)).toBeLessThanOrEqual(dayIndex(p.schedule.start));
      expect(dayIndex(p.latestEnd)).toBeGreaterThanOrEqual(dayIndex(p.schedule.end));
      expect(p.workHours.end).toBeGreaterThan(p.workHours.start);
      if (p.closureType === 'partial') expect(p.affectedLanes).toBeLessThan(SEGMENT_BY_ID.get(p.closures[0].segmentId)!.lanesPerDirection);
    }
    for (const s of SCENARIOS) for (const id of s.projectIds) expect(ps.some((p) => p.id === id)).toBe(true);
    for (const pl of PLACES) expect(NODE_BY_ID.has(pl.nodeId)).toBe(true);
  });
});

describe('network', () => {
  it('lies within Riyadh and is fully connected', () => {
    for (const n of NODES) {
      expect(n.coord[0]).toBeGreaterThan(46.6);
      expect(n.coord[0]).toBeLessThan(46.75);
      expect(n.coord[1]).toBeGreaterThan(24.65);
      expect(n.coord[1]).toBeLessThan(24.78);
    }
    const adj = new Map<string, string[]>();
    for (const s of SEGMENTS) {
      adj.set(s.from, [...(adj.get(s.from) ?? []), s.to]);
      adj.set(s.to, [...(adj.get(s.to) ?? []), s.from]);
    }
    const seen = new Set([NODES[0].id]);
    const q = [NODES[0].id];
    while (q.length) for (const nb of adj.get(q.pop()!) ?? []) if (!seen.has(nb)) (seen.add(nb), q.push(nb));
    expect(seen.size).toBe(NODES.length);
  });
  it('orients King Fahd Rd north-north-west like the real corridor', () => {
    const s = SEGMENT_BY_ID.get('KFR-THL-URB')!;
    const [a, b] = [s.coords[0], s.coords[s.coords.length - 1]];
    expect(b[1]).toBeGreaterThan(a[1]); // northward
    expect(b[0]).toBeLessThan(a[0]); // westward drift
  });
});
