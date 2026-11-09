import { along, length, lineOverlap, lineSliceAlong, lineString, nearestPointOnLine, point } from '@turf/turf';
import type { Feature, LineString } from 'geojson';
import type { ClosureExtent, LngLat, Project } from '@/types';
import { SEGMENT_BY_ID, CLOSABLE_SEGMENTS } from '@/data/network';

export function segmentLine(segmentId: string): Feature<LineString> {
  const s = SEGMENT_BY_ID.get(segmentId);
  if (!s) throw new Error(`Unknown segment ${segmentId}`);
  return lineString(s.coords, { segmentId });
}

/** Geometry of one closure extent (sub-section of a road segment) via Turf. */
export function closureLine(c: ClosureExtent): Feature<LineString> {
  const line = segmentLine(c.segmentId);
  const total = length(line, { units: 'kilometers' });
  const a = Math.max(0, Math.min(c.from, c.to)) * total;
  const b = Math.min(1, Math.max(c.from, c.to)) * total;
  if (b - a < 1e-4) {
    const p = along(line, a, { units: 'kilometers' }).geometry.coordinates;
    return lineString([p, [p[0] + 1e-6, p[1] + 1e-6]], { segmentId: c.segmentId });
  }
  const slice = lineSliceAlong(line, a, b, { units: 'kilometers' });
  slice.properties = { segmentId: c.segmentId };
  return slice;
}

export function projectLines(p: Pick<Project, 'closures'>): Feature<LineString>[] {
  return p.closures.map(closureLine);
}

export function projectMidpoint(p: Pick<Project, 'closures'>): LngLat {
  const l = closureLine(p.closures[0]);
  const km = length(l, { units: 'kilometers' });
  return along(l, km / 2, { units: 'kilometers' }).geometry.coordinates as LngLat;
}

export function closureLengthKm(p: Pick<Project, 'closures'>): number {
  return projectLines(p).reduce((s, l) => s + length(l, { units: 'kilometers' }), 0);
}

/** Minimum distance (km) between two projects' closure geometries (sampled every ~25 m). */
export function minDistanceKm(a: Pick<Project, 'closures'>, b: Pick<Project, 'closures'>): number {
  let best = Infinity;
  for (const la of projectLines(a))
    for (const lb of projectLines(b)) {
      best = Math.min(best, lineToLineKm(la, lb), lineToLineKm(lb, la));
      if (best === 0) return 0;
    }
  return best;
}

function lineToLineKm(a: Feature<LineString>, b: Feature<LineString>): number {
  const km = length(a, { units: 'kilometers' });
  const n = Math.max(2, Math.ceil(km / 0.025));
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const p = along(a, (km * i) / n, { units: 'kilometers' });
    const d = nearestPointOnLine(b, p, { units: 'kilometers' }).properties.dist ?? Infinity;
    if (d < best) best = d;
  }
  return best;
}

/**
 * Shared closure length (km) where two projects' geometries overlap.
 * Candidate overlap = intersection of the two extents on the same segment; it is then
 * CONFIRMED geometrically with Turf (both endpoints lie on both closure lines).
 */
export function overlapLengthKm(a: Pick<Project, 'closures'>, b: Pick<Project, 'closures'>): number {
  let km = 0;
  for (const ca of a.closures)
    for (const cb of b.closures) {
      if (ca.segmentId !== cb.segmentId) continue;
      const lo = Math.max(Math.min(ca.from, ca.to), Math.min(cb.from, cb.to));
      const hi = Math.min(Math.max(ca.from, ca.to), Math.max(cb.from, cb.to));
      if (hi - lo <= 1e-6) continue;
      const ov = closureLine({ segmentId: ca.segmentId, from: lo, to: hi });
      const la = closureLine(ca);
      const lb = closureLine(cb);
      const ends = [ov.geometry.coordinates[0], ov.geometry.coordinates[ov.geometry.coordinates.length - 1]];
      const confirmed = ends.every(
        (e) =>
          (nearestPointOnLine(la, point(e), { units: 'kilometers' }).properties.dist ?? 1) < 0.002 &&
          (nearestPointOnLine(lb, point(e), { units: 'kilometers' }).properties.dist ?? 1) < 0.002,
      );
      if (confirmed) km += length(ov, { units: 'kilometers' });
    }
  return km;
}

/** Turf lineOverlap features for map display of shared closure stretches. */
export function overlapFeatures(a: Pick<Project, 'closures'>, b: Pick<Project, 'closures'>) {
  const out = [] as Feature<LineString>[];
  for (const ca of a.closures)
    for (const cb of b.closures) {
      if (ca.segmentId !== cb.segmentId) continue;
      const lo = Math.max(Math.min(ca.from, ca.to), Math.min(cb.from, cb.to));
      const hi = Math.min(Math.max(ca.from, ca.to), Math.max(cb.from, cb.to));
      if (hi - lo > 1e-6) out.push(closureLine({ segmentId: ca.segmentId, from: lo, to: hi }));
    }
  void lineOverlap;
  return out;
}

/** Snap a clicked point to the nearest closable segment. */
export function snapToSegment(p: LngLat, maxKm = 0.35): { segmentId: string; fraction: number; distKm: number } | null {
  let best: { segmentId: string; fraction: number; distKm: number } | null = null;
  for (const s of CLOSABLE_SEGMENTS) {
    const line = lineString(s.coords);
    const np = nearestPointOnLine(line, point(p), { units: 'kilometers' });
    const d = np.properties.dist ?? Infinity;
    if (d <= maxKm && (!best || d < best.distKm)) {
      const loc = np.properties.location ?? 0;
      best = { segmentId: s.id, fraction: Math.max(0, Math.min(1, loc / s.lengthKm)), distKm: d };
    }
  }
  return best;
}

export function projectFeatureCollection(projects: Project[]) {
  return {
    type: 'FeatureCollection' as const,
    features: projects.flatMap((p) =>
      projectLines(p).map((l) => ({ ...l, properties: { ...l.properties, projectId: p.id, orgId: p.orgId, status: p.status } })),
    ),
  };
}
