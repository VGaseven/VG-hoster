/**
 * Deterministic demo traffic model for the 5-block prototype (DEMO DATA / SIMULATED).
 * Directed links per road, BPR link times, Method of Successive Averages, gate-to-gate
 * demand. Small enough to recompute instantly on every scenario change.
 */
import { NODE_BY, TWIN_NODES, TWIN_ROADS, roadLength, type TwinRoad } from './layout';
import type { Excavation, TwinMetrics, ConflictResult } from './adapter';

export const LANE_CAP = 1800;
const ALPHA = 0.15;
const BETA = 4;

export interface Link {
  i: number;
  road: TwinRoad;
  from: string;
  to: string;
  lenKm: number;
  lanes: number;
  cap: number;
  t0: number; // hours
}

export interface Assignment {
  links: Link[];
  flow: number[];
  time: number[];
  /** OD key → ordered link indices */
  paths: Map<string, number[]>;
  vehHours: number;
  vehKm: number;
}

/** Synthetic peak-hour demand between gates (veh/h) — calibrated for a busy but flowing normal state. */
export const DEMAND: { o: string; d: string; v: number }[] = [
  { o: 'A-S', d: 'A-N', v: 4700 },
  { o: 'A-N', d: 'A-S', v: 4500 },
  { o: 'B-S', d: 'B-N', v: 700 },
  { o: 'B-N', d: 'B-S', v: 650 },
  { o: 'A-S', d: 'E2', v: 450 },
  { o: 'E2', d: 'A-N', v: 420 },
  { o: 'W-W', d: 'A-N', v: 380 },
  { o: 'A-S', d: 'W-W', v: 360 },
  { o: 'B-S', d: 'A-N', v: 300 },
  { o: 'W-W', d: 'E2', v: 260 },
];
/** Bridge traffic (independent overpass, shown for context). */
export const BRIDGE_DEMAND = [
  { o: 'K-W', d: 'K-E', v: 3200 },
  { o: 'K-E', d: 'K-W', v: 3000 },
];

export const odKey = (o: string, d: string) => `${o}>${d}`;

/** Lane reductions from active excavations: road id → lanes closed per direction. */
export function closuresOf(active: Excavation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of active) m.set(e.roadId, Math.min((m.get(e.roadId) ?? 0) + e.lanesClosed, ROAD_LANES(e.roadId)));
  return m;
}
const ROAD_LANES = (id: string) => TWIN_ROADS.find((r) => r.id === id)!.lanes;

function buildLinks(closed: Map<string, number>): Link[] {
  const links: Link[] = [];
  for (const r of TWIN_ROADS) {
    const lanes = r.lanes - (closed.get(r.id) ?? 0);
    if (lanes <= 0) continue;
    const workZone = (closed.get(r.id) ?? 0) > 0 ? 0.6 : 1;
    const lenKm = roadLength(r) / 1000;
    for (const [a, b] of [
      [r.from, r.to],
      [r.to, r.from],
    ])
      links.push({ i: links.length, road: r, from: a, to: b, lenKm, lanes, cap: lanes * LANE_CAP, t0: lenKm / (r.speedKmh * workZone) });
  }
  return links;
}

function dijkstra(links: Link[], cost: number[], o: string, d: string): number[] | null {
  const dist = new Map<string, number>([[o, 0]]);
  const prev = new Map<string, number>();
  const done = new Set<string>();
  const ids = TWIN_NODES.map((n) => n.id);
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const id of ids) if (!done.has(id) && (dist.get(id) ?? Infinity) < best) ((best = dist.get(id)!), (u = id));
    if (u === null) break;
    if (u === d) break;
    done.add(u);
    // gates are not through-nodes
    if (u !== o && NODE_BY.get(u)!.gate) continue;
    for (const l of links) {
      if (l.from !== u) continue;
      const nd = best + cost[l.i];
      if (nd < (dist.get(l.to) ?? Infinity)) {
        dist.set(l.to, nd);
        prev.set(l.to, l.i);
      }
    }
  }
  if (!prev.has(d)) return null;
  const path: number[] = [];
  let cur = d;
  while (cur !== o) {
    const li = prev.get(cur)!;
    path.push(li);
    cur = links[li].from;
  }
  return path.reverse();
}

const bpr = (l: Link, v: number) => l.t0 * Math.min(8, 1 + ALPHA * Math.pow(v / l.cap, BETA));

const cache = new Map<string, Assignment>();

export function assignTwin(closed: Map<string, number>): Assignment {
  const key = [...closed.entries()].sort().map(([k, v]) => `${k}:${v}`).join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const links = buildLinks(closed);
  const demand = [...DEMAND, ...BRIDGE_DEMAND];
  const aon = (cost: number[]) => {
    const f = new Array(links.length).fill(0);
    for (const od of demand) for (const li of dijkstra(links, cost, od.o, od.d) ?? []) f[li] += od.v;
    return f;
  };
  let x = aon(links.map((l) => l.t0));
  for (let k = 1; k <= 25; k++) {
    const t = links.map((l) => bpr(l, x[l.i]));
    const y = aon(t);
    x = x.map((xi, i) => xi + (y[i] - xi) / (k + 1));
  }
  const time = links.map((l) => bpr(l, x[l.i]));
  const paths = new Map<string, number[]>();
  for (const od of demand) paths.set(odKey(od.o, od.d), dijkstra(links, time, od.o, od.d) ?? []);
  const res: Assignment = {
    links,
    flow: x,
    time,
    paths,
    vehHours: links.reduce((s, l) => s + x[l.i] * time[l.i], 0),
    vehKm: links.reduce((s, l) => s + x[l.i] * l.lenKm, 0),
  };
  cache.set(key, res);
  return res;
}

/** Per-road max V/C (both directions). */
export function roadVc(a: Assignment): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of a.links) m.set(l.road.id, Math.max(m.get(l.road.id) ?? 0, a.flow[l.i] / l.cap));
  return m;
}

/** Per-road speed ratio (congested / free) for vehicle animation. */
export function roadSpeed(a: Assignment): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of a.links) m.set(`${l.from}>${l.to}`, l.t0 / a.time[l.i]);
  return m;
}

const totalTrips = DEMAND.reduce((s, d) => s + d.v, 0);

export function metricsFor(active: Excavation[], conflicts: ConflictResult[]): TwinMetrics {
  const base = assignTwin(new Map());
  const closed = closuresOf(active);
  const cur = assignTwin(closed);
  const vcB = roadVc(base);
  const vcC = roadVc(cur);
  // ground network only (bridge demand is unaffected context traffic)
  const ground = (a: Assignment) => a.links.reduce((s, l) => s + (l.road.kind === 'bridge' ? 0 : a.flow[l.i] * a.time[l.i]), 0);
  const delayVehH = Math.max(0, ground(cur) - ground(base));
  const affected = [...vcC.entries()]
    .filter(([id, v]) => id !== 'K-1' && (closed.has(id) || v > (vcB.get(id) ?? 0) * 1.15 + 0.05))
    .map(([id]) => id);
  // vehicles/hour that left the restricted roads (flow lost on closed roads vs normal)
  const roadFlow = (a: Assignment, id: string) => a.links.filter((l) => l.road.id === id).reduce((s, l) => s + a.flow[l.i], 0);
  let rerouted = 0;
  for (const id of closed.keys()) rerouted += Math.max(0, roadFlow(base, id) - roadFlow(cur, id));
  const tripMin = (a: Assignment) => (a.paths.get(odKey('A-S', 'A-N')) ?? []).reduce((s, i) => s + a.time[i], 0) * 60;
  const maxVc = Math.max(...[...vcC.entries()].filter(([id]) => id !== 'K-1').map(([, v]) => v));
  return {
    activeExcavations: active.length,
    activeClosures: closed.size,
    detectedConflicts: conflicts.length,
    affectedRoadIds: affected,
    maxVc,
    congestionIndex: Math.round(maxVc * 100),
    delayVehHours: delayVehH,
    avgDelayMin: (delayVehH / totalTrips) * 60,
    reroutedVehPerHour: Math.round(rerouted),
    corridorTripMin: tripMin(cur),
    corridorTripMinNormal: tripMin(base),
  };
}

/**
 * Conflict rule (same logic as the main RASD engine, simplified): two excavations conflict when
 * their dates overlap AND one closes a road that carries the other's diverted traffic (≥ 300 veh/h
 * extra) or they share the same road.
 */
export function detectTwinConflicts(list: Excavation[]): ConflictResult[] {
  const out: ConflictResult[] = [];
  const base = assignTwin(new Map());
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      const s = Math.max(day(a.start), day(b.start));
      const e = Math.min(day(a.end), day(b.end));
      if (e < s) continue;
      const sameRoad = a.roadId === b.roadId;
      const divertA = extraFlow(assignTwin(closuresOf([a])), base, b.roadId);
      const divertB = extraFlow(assignTwin(closuresOf([b])), base, a.roadId);
      const diverted = Math.max(divertA, divertB);
      if (!sameRoad && diverted < 300) continue;
      const solo = Math.max(metricsFor([a], []).delayVehHours, metricsFor([b], []).delayVehHours);
      const joint = metricsFor([a, b], []).delayVehHours;
      out.push({
        id: `CF-${a.id}-${b.id}`,
        projectIds: [a.id, b.id],
        kind: sameRoad ? 'same-road' : 'detour',
        overlapStart: iso(s),
        overlapEnd: iso(e),
        overlapDays: e - s + 1,
        divertedVehPerHour: Math.round(diverted),
        congestionIncreasePct: solo > 0 ? Math.round(((joint - solo) / solo) * 100) : 0,
        explanationAr: sameRoad
          ? 'المشروعان يغلقان نفس الطريق في فترة متداخلة.'
          : `حفرية «${a.titleAr}» تحوّل نحو ${Math.round(divertA)} مركبة/ساعة إلى ${roadName(b.roadId)} — وهو الطريق الذي تغلقه حفرية «${b.titleAr}» في نفس الفترة، فيُغلق الطريق الرئيسي وبديله معاً.`,
      });
    }
  return out;
}

function extraFlow(cur: Assignment, base: Assignment, roadId: string) {
  const f = (a: Assignment) => a.links.filter((l) => l.road.id === roadId).reduce((s, l) => s + a.flow[l.i], 0);
  return Math.max(0, f(cur) - f(base));
}

const roadName = (id: string) => TWIN_ROADS.find((r) => r.id === id)!.nameAr;

/** RASD recommendation: move the more flexible project to start after the other ends (+buffer). */
export function recommend(list: Excavation[], c: ConflictResult) {
  const [a, b] = c.projectIds.map((id) => list.find((x) => x.id === id)!);
  const movable = [b, a].find((x) => x.flexible) ?? b;
  const other = movable === a ? b : a;
  const dur = day(movable.end) - day(movable.start);
  const start = day(other.end) + 2;
  const feasible = start + dur <= day(movable.latestEnd);
  return {
    projectId: movable.id,
    from: { start: movable.start, end: movable.end },
    to: { start: iso(start), end: iso(start + dur) },
    feasible,
    titleAr: 'تأخير الموعد حسب الأولوية',
    reasonAr: feasible
      ? `تأجيل «${movable.titleAr}» ليبدأ بعد انتهاء «${other.titleAr}» بيومين، فيبقى ${roadName(movable.roadId)} مساراً بديلاً مفتوحاً طوال فترة الحفرية الأولى.`
      : 'لا يتسع موعد الإنجاز المسموح للتأجيل؛ يلزم تنسيق يدوي.',
  };
}

const D0 = Date.parse('2026-12-01T00:00:00Z');
export const day = (s: string) => Math.round((Date.parse(`${s}T00:00:00Z`) - D0) / 864e5);
export const iso = (d: number) => new Date(D0 + d * 864e5).toISOString().slice(0, 10);
