/**
 * Deterministic scenario data shared by every video scene. Computed from the same engine
 * the web application uses (no hard-coded improvements).
 */
import type { Conflict, OptimizationOption, Project, ScenarioMetrics } from '@/types';
import { createDemoConflictProject, createSeedProjects, CITIZEN_JOURNEYS, PLACES } from '@/data/projects';
import { syncStatusesPure } from './syncStatuses';
import { detectConflicts } from '@/engine/conflicts/detect';
import { applyChanges, evaluateSchedule, generateOptions } from '@/engine/optimization/optimize';
import { snapshotAt } from '@/engine/traffic/simulate';
import { vehicleSet, type VehicleSet } from '@/engine/traffic/vehicles';
import { planJourney } from '@/engine/routing/journey';
import { dayIndex } from '@/utils/date';

export interface VideoData {
  before: Project[];
  after: Project[];
  conflict: Conflict;
  options: OptimizationOption[];
  chosen: OptimizationOption | null;
  mBefore: ScenarioMetrics;
  mAfter: ScenarioMetrics;
  snapBefore: ReturnType<typeof snapshotAt>;
  snapAfter: ReturnType<typeof snapshotAt>;
  snapA: ReturnType<typeof snapshotAt>;
  vehBefore: VehicleSet;
  vehAfter: VehicleSet;
  vehA: VehicleSet;
  journey: ReturnType<typeof planJourney>;
  journeyTitle: string;
  focusDay: number;
}

let cached: VideoData | null = null;

export function getVideoData(): VideoData {
  if (cached) return cached;
  const base = createSeedProjects();
  const withDemo = syncStatusesPure([...base, createDemoConflictProject()]);
  const conflicts = detectConflicts(withDemo);
  const conflict = conflicts.find((c) => c.projectIds.includes('RASD-D01') && c.projectIds.includes('RASD-P01')) ?? conflicts[0];
  const opt = generateOptions(conflict, withDemo);
  const chosen = opt.options.find((o) => o.recommended) ?? null;
  let after = chosen ? applyChanges(withDemo, chosen.changes) : withDemo;
  const changed = new Set(chosen?.changes.map((c) => c.projectId) ?? []);
  after = after.map((p) => (changed.has(p.id) ? { ...p, status: 'scheduled' as const } : conflict.projectIds.includes(p.id) ? { ...p, status: 'approved' as const } : p));
  const focusDay = dayIndex('2026-12-16');
  const snapBefore = snapshotAt(withDemo, focusDay, 8);
  const snapAfter = snapshotAt(after, focusDay, 8);
  const projA = withDemo.filter((p) => p.id === 'RASD-P01');
  const snapA = snapshotAt(projA, focusDay, 8);
  const j = CITIZEN_JOURNEYS[0];
  const o = PLACES.find((p) => p.id === j.originPlaceId)!;
  const d = PLACES.find((p) => p.id === j.destinationPlaceId)!;
  cached = {
    before: withDemo,
    after,
    conflict,
    options: opt.options,
    chosen,
    mBefore: evaluateSchedule(withDemo),
    mAfter: evaluateSchedule(after),
    snapBefore,
    snapAfter,
    snapA,
    vehBefore: vehicleSet(snapBefore.result, 260, 7),
    vehAfter: vehicleSet(snapAfter.result, 260, 7),
    vehA: vehicleSet(snapA.result, 260, 7),
    journey: planJourney(after, o.nodeId, d.nodeId, j.date, j.hour, true),
    journeyTitle: j.titleAr,
    focusDay,
  };
  return cached;
}
