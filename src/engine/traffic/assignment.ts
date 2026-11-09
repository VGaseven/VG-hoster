/**
 * Static user-equilibrium traffic assignment (Method of Successive Averages, BPR link
 * performance). Deterministic. Demand is synthetic (gravity-style weights calibrated so
 * the no-closure peak-hour equilibrium reaches V/C ≈ 1.2 on the busiest King Fahd Rd block,
 * i.e. a congested peak with parallel arterials carrying diverted traffic). NOT real telemetry.
 */
import { GATES, ZONES, NODES, SEGMENTS } from '@/data/network';
import { buildGraph, dijkstra, tracePath, type Graph } from '@/engine/routing/router';
import { effectsKey, type Effects } from './effects';

export const BPR_ALPHA = 0.15;
export const BPR_BETA = 4;
export const MAX_TIME_FACTOR = 8;
export const MSA_ITERATIONS = 20;
/** Penalty for trips with no path inside the study network (forced external detour). */
export const UNSERVED_PENALTY_H = 0.5;
export const UNSERVED_DETOUR_KM = 12;

/** Hourly demand factors relative to the AM/PM peak hour (synthetic profile). */
export const HOURLY_FACTORS = [
  0.15, 0.1, 0.08, 0.08, 0.12, 0.3, 0.6, 0.95, 1.0, 0.8, 0.7, 0.7, 0.75, 0.75, 0.75, 0.8, 0.9, 1.0, 0.95, 0.85, 0.75, 0.6, 0.4, 0.25,
];
export const BANDS = [0.15, 0.4, 0.75, 1.0];
export function bandOfHour(hour: number): number {
  const f = HOURLY_FACTORS[Math.floor(hour) % 24];
  let best = 0;
  for (let i = 1; i < BANDS.length; i++) if (Math.abs(BANDS[i] - f) < Math.abs(BANDS[best] - f)) best = i;
  return best;
}

const GATE_WEIGHT: Record<string, number> = { KFR: 10, MAK: 7, KAR: 7, OLY: 4, TAK: 4, THL: 3, URB: 3 };
const ZONE_WEIGHT: Record<string, number> = { 'Z-KINGDOM': 5, 'Z-FAISALIAH': 4 };

export const CENTROIDS = [...GATES, ...ZONES];
const NODE_IDX = new Map(NODES.map((n, i) => [n.id, i]));

function weight(id: string): number {
  if (id.startsWith('G-')) return GATE_WEIGHT[id.split('-')[1]] ?? 3;
  return ZONE_WEIGHT[id] ?? 4;
}

export interface OD {
  o: number;
  d: number;
  oId: string;
  dId: string;
  trips: number; // peak-hour veh/h
}

function rawOds(): OD[] {
  const ods: OD[] = [];
  for (const a of CENTROIDS)
    for (const b of CENTROIDS) {
      if (a.id === b.id) continue;
      // Gates on the same road & same end are the same entry point — skip trivial pairs.
      const sameRoad = a.id.startsWith('G-') && b.id.startsWith('G-') && a.id.split('-')[1] === b.id.split('-')[1];
      const factor = sameRoad ? 1.6 : 1; // strong through-movement along each corridor
      ods.push({ o: NODE_IDX.get(a.id)!, d: NODE_IDX.get(b.id)!, oId: a.id, dId: b.id, trips: weight(a.id) * weight(b.id) * factor });
    }
  return ods;
}

/**
 * Calibrate demand so the no-closure peak-hour EQUILIBRIUM reaches V/C ≈ TARGET_PEAK_VC
 * on the busiest link (two passes because BPR is non-linear).
 */
export const TARGET_PEAK_VC = 1.2;
export const OD_PAIRS: OD[] = (() => {
  let ods = rawOds();
  const g = buildGraph(new Map());
  for (let pass = 0; pass < 8; pass++) {
    const { x } = runMsa(g, ods, 1);
    let maxVc = 0;
    for (const l of g.links) if (!g.isZone[l.from] && !g.isZone[l.to]) maxVc = Math.max(maxVc, x[l.idx] / l.capacity);
    const k = TARGET_PEAK_VC / maxVc;
    ods = ods.map((od) => ({ ...od, trips: od.trips * k }));
  }
  return ods.map((od) => ({ ...od, trips: Math.round(od.trips * 10) / 10 }));
})();

function runMsa(g: Graph, ods: OD[], scale: number) {
  const nL = g.links.length;
  let x = aon(g, ods, g.links.map((l) => l.t0), scale);
  const t = new Float64Array(nL);
  for (let k = 1; k <= MSA_ITERATIONS; k++) {
    for (const l of g.links) t[l.idx] = bpr(l.t0, x[l.idx], l.capacity);
    const y = aon(g, ods, t, scale);
    const step = 1 / (k + 1);
    const nx = new Float64Array(nL);
    for (let i = 0; i < nL; i++) nx[i] = x[i] + step * (y[i] - x[i]);
    x = nx;
  }
  for (const l of g.links) t[l.idx] = bpr(l.t0, x[l.idx], l.capacity);
  return { x, t };
}

export const PEAK_TRIPS = OD_PAIRS.reduce((s, o) => s + o.trips, 0);

function aon(g: Graph, ods: OD[], cost: ArrayLike<number>, scale: number): Float64Array {
  const flows = new Float64Array(g.links.length);
  const c = Float64Array.from(cost);
  const byOrigin = groupByOrigin(ods);
  for (const [o, list] of byOrigin) {
    const tree = dijkstra(g, o, c);
    for (const od of list) {
      const path = tracePath(tree, g, od.d);
      if (!path) continue;
      for (const li of path) flows[li] += od.trips * scale;
    }
  }
  return flows;
}

function groupByOrigin(ods: OD[]) {
  const m = new Map<number, OD[]>();
  for (const od of ods) {
    const l = m.get(od.o) ?? [];
    l.push(od);
    m.set(od.o, l);
  }
  return m;
}

function bpr(t0: number, v: number, c: number) {
  if (c <= 0) return t0 * MAX_TIME_FACTOR;
  return t0 * Math.min(MAX_TIME_FACTOR, 1 + BPR_ALPHA * Math.pow(v / c, BPR_BETA));
}

export interface PathInfo {
  links: number[];
  segIds: string[];
  timeH: number;
  km: number;
}

export interface AssignResult {
  key: string;
  band: number;
  graph: Graph;
  flows: Float64Array;
  times: Float64Array;
  paths: Map<string, PathInfo | null>;
  sysVehHours: number;
  sysVehKm: number;
  unservedTrips: number;
  /** per-segment max V/C (closed segments → Infinity) */
  vcBySeg: Map<string, number>;
  /** per-segment two-way flow (veh/h) */
  flowBySeg: Map<string, number>;
  speedFactorBySeg: Map<string, number>;
  maxVc: number;
  /** zone id → mean OD time (h) to all gates (Infinity if any unreachable) */
  zoneTimes: Map<string, number[]>;
}

const cache = new Map<string, AssignResult>();
export function clearAssignmentCache() {
  cache.clear();
}

export function odKey(o: string, d: string) {
  return `${o}>${d}`;
}

export function assign(effects: Effects, band: number): AssignResult {
  const key = `${band}|${effectsKey(effects)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const scale = BANDS[band];
  const g = buildGraph(effects);
  const { x, t } = runMsa(g, OD_PAIRS, scale);

  // Final shortest paths (used by vehicles, citizen routing and OD times)
  const paths = new Map<string, PathInfo | null>();
  let unserved = 0;
  for (const [o, list] of groupByOrigin(OD_PAIRS)) {
    const tree = dijkstra(g, o, t);
    for (const od of list) {
      const p = tracePath(tree, g, od.d);
      if (!p) {
        paths.set(odKey(od.oId, od.dId), null);
        unserved += od.trips * scale;
        continue;
      }
      paths.set(odKey(od.oId, od.dId), {
        links: p,
        segIds: p.map((li) => g.links[li].segId),
        timeH: p.reduce((s, li) => s + t[li], 0),
        km: p.reduce((s, li) => s + g.links[li].lengthKm, 0),
      });
    }
  }

  let vh = 0;
  let vk = 0;
  const vcBySeg = new Map<string, number>();
  const flowBySeg = new Map<string, number>();
  const speedFactorBySeg = new Map<string, number>();
  for (const s of SEGMENTS) vcBySeg.set(s.id, Infinity);
  for (const l of g.links) {
    vh += x[l.idx] * t[l.idx];
    vk += x[l.idx] * l.lengthKm;
    const vc = x[l.idx] / l.capacity;
    const prev = vcBySeg.get(l.segId)!;
    vcBySeg.set(l.segId, prev === Infinity ? vc : Math.max(prev, vc));
    flowBySeg.set(l.segId, (flowBySeg.get(l.segId) ?? 0) + x[l.idx]);
    const sf = l.t0 / t[l.idx];
    speedFactorBySeg.set(l.segId, Math.min(speedFactorBySeg.get(l.segId) ?? 1, sf));
  }
  let maxVc = 0;
  for (const s of SEGMENTS) {
    const v = vcBySeg.get(s.id)!;
    if (Number.isFinite(v) && s.closable) maxVc = Math.max(maxVc, v);
  }

  const zoneTimes = new Map<string, number[]>();
  for (const z of ZONES)
    zoneTimes.set(
      z.id,
      GATES.map((gt) => paths.get(odKey(z.id, gt.id))?.timeH ?? Infinity),
    );

  const res: AssignResult = {
    key,
    band,
    graph: g,
    flows: x,
    times: t,
    paths,
    sysVehHours: vh,
    sysVehKm: vk,
    unservedTrips: unserved,
    vcBySeg,
    flowBySeg,
    speedFactorBySeg,
    maxVc,
    zoneTimes,
  };
  if (cache.size > 4000) cache.clear();
  cache.set(key, res);
  return res;
}

export const BASELINE = (band: number) => assign(new Map(), band);

/** Accessibility score 0..100: mean over zones & gates of baseline time / current time. */
export function accessibilityScore(r: AssignResult): number {
  const base = BASELINE(r.band);
  let sum = 0;
  let n = 0;
  for (const z of ZONES) {
    const cur = r.zoneTimes.get(z.id)!;
    const b = base.zoneTimes.get(z.id)!;
    for (let i = 0; i < cur.length; i++) {
      sum += Number.isFinite(cur[i]) ? Math.min(1, b[i] / cur[i]) : 0;
      n++;
    }
  }
  return (sum / n) * 100;
}

export function zoneAccessibility(r: AssignResult, zoneId: string): number {
  const base = BASELINE(r.band);
  const cur = r.zoneTimes.get(zoneId)!;
  const b = base.zoneTimes.get(zoneId)!;
  let s = 0;
  for (let i = 0; i < cur.length; i++) s += Number.isFinite(cur[i]) ? Math.min(1, b[i] / cur[i]) : 0;
  return (s / cur.length) * 100;
}

/** Vehicle-hours of delay vs the no-closure baseline at the same demand band (one hour). */
export function hourlyDelay(r: AssignResult): number {
  const base = BASELINE(r.band);
  return Math.max(0, r.sysVehHours - base.sysVehHours) + r.unservedTrips * UNSERVED_PENALTY_H;
}

export function hourlyDetourKm(r: AssignResult): number {
  const base = BASELINE(r.band);
  return Math.max(0, r.sysVehKm - base.sysVehKm) + r.unservedTrips * UNSERVED_DETOUR_KM;
}
