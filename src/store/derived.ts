/** Memoized derived data shared across components (keyed by the projects array identity). */
import { useMemo } from 'react';
import type { Conflict, EconomicAssumptions, Project, ScenarioMetrics } from '@/types';
import { detectConflicts } from '@/engine/conflicts/detect';
import { evaluateSchedule } from '@/engine/optimization/optimize';
import { snapshotAt } from '@/engine/traffic/simulate';
import { isActiveAt, isSimulated } from '@/engine/traffic/effects';

const conflictCache = new WeakMap<Project[], Conflict[]>();
export function getConflicts(projects: Project[]): Conflict[] {
  let c = conflictCache.get(projects);
  if (!c) conflictCache.set(projects, (c = detectConflicts(projects)));
  return c;
}

/** Conflicts that represent modeled/confirmed problems (excludes proximity-only warnings). */
export function actionable(c: Conflict[]) {
  return c.filter((x) => x.kind !== 'proximity' || x.category === 'sequential');
}

const metricsCache = new WeakMap<Project[], Map<string, ScenarioMetrics>>();
export function getMetrics(projects: Project[], e: EconomicAssumptions): ScenarioMetrics {
  let m = metricsCache.get(projects);
  if (!m) metricsCache.set(projects, (m = new Map()));
  const k = JSON.stringify(e);
  let r = m.get(k);
  if (!r) m.set(k, (r = evaluateSchedule(projects, e)));
  return r;
}

const beforeCache = new WeakMap<Project[], Project[]>();
/** "Before coordination": every project on its originally proposed schedule, no shared zones. */
export function beforeProjects(projects: Project[]): Project[] {
  let b = beforeCache.get(projects);
  if (!b)
    beforeCache.set(
      projects,
      (b = projects.map((p) => ({ ...p, schedule: { ...p.proposed }, coordinationGroup: undefined, status: p.status === 'rejected' ? p.status : ('submitted' as const) }))),
    );
  return b;
}

export function useConflicts(projects: Project[]) {
  return useMemo(() => getConflicts(projects), [projects]);
}

export function activeAt(projects: Project[], day: number, hour: number) {
  return new Set(projects.filter((p) => isSimulated(p) && isActiveAt(p, day, hour)).map((p) => p.id));
}

export function useSnapshot(projects: Project[], day: number, hour: number) {
  const h = Math.floor(hour);
  return useMemo(() => snapshotAt(projects, day, h), [projects, day, h]);
}
