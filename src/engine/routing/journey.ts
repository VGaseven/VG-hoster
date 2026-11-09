/**
 * Citizen journey planning on the local network (simulation estimates — not live traffic).
 * Uses the congested link times of the equilibrium assignment for the chosen date/hour.
 */
import type { LngLat, Project } from '@/types';
import { NODES, SEGMENT_BY_ID } from '@/data/network';
import { assign, bandOfHour, BASELINE, type AssignResult } from '@/engine/traffic/assignment';
import { effectsAt, isActiveAt } from '@/engine/traffic/effects';
import { dijkstra, nodeIdx, tracePath } from './router';
import { dayIndex } from '@/utils/date';

export interface RouteResult {
  segIds: string[];
  coords: LngLat[];
  timeMin: number;
  km: number;
}

export function citizenVisible(p: Project, includePending: boolean) {
  if (p.status === 'approved' || p.status === 'scheduled') return true;
  return includePending && p.status !== 'rejected' && p.status !== 'draft';
}

function route(r: AssignResult, o: string, d: string): RouteResult | null {
  const tree = dijkstra(r.graph, nodeIdx(o), r.times);
  const p = tracePath(tree, r.graph, nodeIdx(d));
  if (!p) return null;
  const coords: LngLat[] = [];
  for (const li of p) {
    const l = r.graph.links[li];
    const seg = SEGMENT_BY_ID.get(l.segId)!;
    const pts = NODES[l.from].id === seg.from ? seg.coords : [...seg.coords].reverse();
    for (const c of pts) if (!coords.length || coords[coords.length - 1] !== c) coords.push(c);
  }
  return {
    segIds: p.map((li) => r.graph.links[li].segId),
    coords,
    timeMin: p.reduce((s, li) => s + r.times[li], 0) * 60,
    km: p.reduce((s, li) => s + r.graph.links[li].lengthKm, 0),
  };
}

export function planJourney(projects: Project[], originNode: string, destNode: string, date: string, hour: number, includePending = false) {
  const day = dayIndex(date);
  const visible = projects.filter((p) => citizenVisible(p, includePending));
  const eff = effectsAt(visible, day, hour);
  const band = bandOfHour(hour);
  const cur = assign(eff, band);
  const base = BASELINE(band);
  const normal = route(base, originNode, destNode);
  const now = route(cur, originNode, destNode);
  const affecting = visible.filter((p) => isActiveAt(p, day, hour) && p.closures.some((c) => normal?.segIds.includes(c.segmentId) || now?.segIds.includes(c.segmentId)));
  const blocked = normal ? normal.segIds.filter((s) => eff.has(s)) : [];
  return { normal, now, affecting, blocked, effects: eff };
}

export function bestDeparture(projects: Project[], o: string, d: string, date: string, hour: number, includePending = false) {
  const out: { hour: number; timeMin: number }[] = [];
  for (let h = Math.max(5, hour - 2); h <= Math.min(23, hour + 3); h++) {
    const r = planJourney(projects, o, d, date, h, includePending).now;
    if (r) out.push({ hour: h, timeMin: r.timeMin });
  }
  return out;
}
