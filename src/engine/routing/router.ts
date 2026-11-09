/**
 * Local network router (simulation fallback for OSRM/Valhalla).
 * Directed graph built from the demonstration network; closures remove or narrow links.
 */
import { NODES, SEGMENTS, NODE_BY_ID } from '@/data/network';
import type { Effects } from '@/engine/traffic/effects';

export const LANE_CAPACITY_VPH = 1800;
export const CONNECTOR_CAPACITY_VPH = 900;
/** Work-zone speed reduction on partially closed links. */
export const WORK_ZONE_SPEED_FACTOR = 0.7;

export interface Link {
  idx: number;
  segId: string;
  from: number;
  to: number;
  lengthKm: number;
  t0: number; // free-flow time (h)
  capacity: number; // veh/h
}

export interface Graph {
  links: Link[];
  out: number[][];
  nodeIndex: Map<string, number>;
  isZone: boolean[];
}

const NODE_INDEX = new Map(NODES.map((n, i) => [n.id, i]));
const IS_ZONE = NODES.map((n) => n.kind === 'zone');

export function buildGraph(effects: Effects): Graph {
  const links: Link[] = [];
  const out: number[][] = NODES.map(() => []);
  for (const s of SEGMENTS) {
    const e = effects.get(s.id);
    if (e?.full) continue;
    const lanes = s.lanesPerDirection - (e?.closedLanes ?? 0);
    const cap = s.closable ? lanes * LANE_CAPACITY_VPH : CONNECTOR_CAPACITY_VPH;
    const speed = e && e.closedLanes > 0 ? s.freeSpeedKmh * WORK_ZONE_SPEED_FACTOR : s.freeSpeedKmh;
    const t0 = s.lengthKm / speed;
    for (const [a, b] of [
      [s.from, s.to],
      [s.to, s.from],
    ]) {
      const link: Link = { idx: links.length, segId: s.id, from: NODE_INDEX.get(a)!, to: NODE_INDEX.get(b)!, lengthKm: s.lengthKm, t0, capacity: cap };
      links.push(link);
      out[link.from].push(link.idx);
    }
  }
  return { links, out, nodeIndex: NODE_INDEX, isZone: IS_ZONE };
}

export interface ShortestTree {
  dist: Float64Array;
  prevLink: Int32Array;
}

/** Dijkstra; zone centroids are never used as through-nodes. */
export function dijkstra(g: Graph, origin: number, cost: Float64Array): ShortestTree {
  const n = g.out.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevLink = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[origin] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) ((best = dist[i]), (u = i));
    if (u < 0) break;
    done[u] = 1;
    if (u !== origin && g.isZone[u]) continue;
    for (const li of g.out[u]) {
      const l = g.links[li];
      const nd = best + cost[li];
      if (nd < dist[l.to]) {
        dist[l.to] = nd;
        prevLink[l.to] = li;
      }
    }
  }
  return { dist, prevLink };
}

export function tracePath(tree: ShortestTree, g: Graph, dest: number): number[] | null {
  if (!Number.isFinite(tree.dist[dest])) return null;
  const path: number[] = [];
  let cur = dest;
  while (tree.prevLink[cur] >= 0) {
    const li = tree.prevLink[cur];
    path.push(li);
    cur = g.links[li].from;
  }
  return path.reverse();
}

export function nodeIdx(id: string): number {
  const i = NODE_INDEX.get(id);
  if (i === undefined) throw new Error(`Unknown node ${id}`);
  return i;
}

export function nodeName(idx: number): string {
  return NODES[idx].name;
}

export function nodeById(id: string) {
  return NODE_BY_ID.get(id)!;
}
