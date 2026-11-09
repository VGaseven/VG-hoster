/**
 * Deterministic vehicle visualisation: each simulated vehicle follows its OD's current
 * equilibrium shortest path. Position is a pure function of time, so the same code drives
 * the live map and the frame-by-frame Remotion renderer. Vehicles slow down (and visibly
 * bunch into queues) on congested links because time along the path uses congested link times.
 */
import type { LngLat } from '@/types';
import { SEGMENT_BY_ID, NODES } from '@/data/network';
import { mulberry32 } from '@/utils/random';
import { OD_PAIRS, odKey, type AssignResult } from './assignment';

export interface VehiclePath {
  coords: LngLat[];
  /** cumulative time (h, congested) at each coord */
  cumT: number[];
  /** congested/free speed ratio per piece */
  speedRatio: number[];
  totalT: number;
}

export interface VehicleSet {
  key: string;
  paths: VehiclePath[];
  phase: number[];
}

/** Fixed sampling of OD pairs proportional to demand (seeded). */
function sampleOds(n: number, seed: number) {
  const rnd = mulberry32(seed);
  const total = OD_PAIRS.reduce((s, o) => s + o.trips, 0);
  const cum: number[] = [];
  let acc = 0;
  for (const o of OD_PAIRS) cum.push((acc += o.trips / total));
  const picks: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    picks.push(lo);
  }
  return { picks, phase: picks.map(() => rnd()) };
}

const pathCache = new Map<string, VehiclePath | null>();

function buildPath(r: AssignResult, odIndex: number): VehiclePath | null {
  const od = OD_PAIRS[odIndex];
  const ck = `${r.key}#${odIndex}`;
  if (pathCache.has(ck)) return pathCache.get(ck)!;
  const p = r.paths.get(odKey(od.oId, od.dId));
  if (!p) {
    pathCache.set(ck, null);
    return null;
  }
  const coords: LngLat[] = [];
  const cumT: number[] = [];
  const speedRatio: number[] = [];
  let t = 0;
  for (const li of p.links) {
    const link = r.graph.links[li];
    const seg = SEGMENT_BY_ID.get(link.segId)!;
    const forward = NODES[link.from].id === seg.from;
    const pts = forward ? seg.coords : [...seg.coords].reverse();
    const linkT = r.times[li];
    const ratio = link.t0 / linkT;
    const segLen = pts.length - 1;
    for (let i = 0; i < pts.length; i++) {
      if (coords.length && i === 0) continue;
      coords.push(pts[i]);
      if (cumT.length === 0) cumT.push(0);
      else {
        t += linkT / segLen;
        cumT.push(t);
        speedRatio.push(ratio);
      }
    }
  }
  const vp = coords.length >= 2 ? { coords, cumT, speedRatio, totalT: t } : null;
  if (pathCache.size > 20000) pathCache.clear();
  pathCache.set(ck, vp);
  return vp;
}

const sampleCache = new Map<string, ReturnType<typeof sampleOds>>();

export function vehicleSet(r: AssignResult, n = 320, seed = 42): VehicleSet {
  const sk = `${n}:${seed}`;
  let s = sampleCache.get(sk);
  if (!s) sampleCache.set(sk, (s = sampleOds(n, seed)));
  const paths: VehiclePath[] = [];
  const phase: number[] = [];
  s.picks.forEach((odi, i) => {
    const vp = buildPath(r, odi);
    if (vp) {
      paths.push(vp);
      phase.push(s!.phase[i]);
    }
  });
  return { key: r.key, paths, phase };
}

/**
 * Positions at visual time `tSec`. `timeScale` = simulated hours per visual second.
 * Returns [lng, lat, speedRatio].
 */
export function vehiclePositions(set: VehicleSet, tSec: number, timeScale = 0.006): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < set.paths.length; i++) {
    const p = set.paths[i];
    if (p.totalT <= 0) continue;
    let tau = (set.phase[i] * p.totalT + tSec * timeScale) % p.totalT;
    if (tau < 0) tau += p.totalT;
    let lo = 0;
    let hi = p.cumT.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (p.cumT[mid] <= tau) lo = mid;
      else hi = mid;
    }
    const span = p.cumT[hi] - p.cumT[lo] || 1;
    const f = (tau - p.cumT[lo]) / span;
    const a = p.coords[lo];
    const b = p.coords[hi];
    // keep-right lateral offset so opposing directions are visually separated
    const dx = (b[0] - a[0]) * 0.908;
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const off = 0.00009 * ((i % 3) * 0.5 + 0.6);
    out.push([a[0] + (b[0] - a[0]) * f + ((dy / len) * off) / 0.908, a[1] + (b[1] - a[1]) * f - (dx / len) * off, p.speedRatio[lo] ?? 1]);
  }
  return out;
}
