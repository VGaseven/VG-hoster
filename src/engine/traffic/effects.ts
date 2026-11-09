import type { Project } from '@/types';
import { SEGMENT_BY_ID } from '@/data/network';
import { dayIndex } from '@/utils/date';

export interface SegmentEffect {
  closedLanes: number;
  full: boolean;
}
export type Effects = Map<string, SegmentEffect>;

/** Projects that occupy the road network in a simulation (drafts/rejected are excluded). */
export function isSimulated(p: Project): boolean {
  return p.status !== 'rejected' && p.status !== 'draft';
}

export function isActiveOnDay(p: Project, day: number): boolean {
  return day >= dayIndex(p.schedule.start) && day <= dayIndex(p.schedule.end);
}

export function isActiveAt(p: Project, day: number, hour: number): boolean {
  if (!isActiveOnDay(p, day)) return false;
  const h = Math.floor(hour);
  return h >= p.workHours.start && h < p.workHours.end;
}

/**
 * Combine project closures into per-segment effects. Projects sharing a coordination group
 * occupy ONE shared work zone (lanes = max of the group); independent projects add up.
 * A closure anywhere within a block applies to that whole block link (no intermediate access).
 */
export function combineEffects(projects: Project[]): Effects {
  const perSeg = new Map<string, Map<string, { lanes: number; full: boolean }>>();
  for (const p of projects) {
    for (const c of p.closures) {
      const groups = perSeg.get(c.segmentId) ?? new Map();
      const gid = p.coordinationGroup ?? p.id;
      const prev = groups.get(gid) ?? { lanes: 0, full: false };
      groups.set(gid, {
        lanes: Math.max(prev.lanes, p.closureType === 'full' ? 99 : p.affectedLanes),
        full: prev.full || p.closureType === 'full',
      });
      perSeg.set(c.segmentId, groups);
    }
  }
  const eff: Effects = new Map();
  for (const [segId, groups] of perSeg) {
    const seg = SEGMENT_BY_ID.get(segId);
    if (!seg) continue;
    let lanes = 0;
    let full = false;
    for (const g of groups.values()) {
      lanes += g.lanes;
      full ||= g.full;
    }
    if (lanes >= seg.lanesPerDirection) full = true;
    eff.set(segId, { closedLanes: full ? seg.lanesPerDirection : lanes, full });
  }
  return eff;
}

export function effectsAt(projects: Project[], day: number, hour: number): Effects {
  return combineEffects(projects.filter((p) => isSimulated(p) && isActiveAt(p, day, hour)));
}

export function effectsKey(eff: Effects): string {
  return [...eff.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, e]) => `${k}:${e.full ? 'F' : e.closedLanes}`)
    .join('|');
}
