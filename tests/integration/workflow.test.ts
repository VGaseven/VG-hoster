import { describe, expect, it } from 'vitest';
import { createDemoConflictProject, createSeedProjects, CITIZEN_JOURNEYS, PLACES } from '@/data/projects';
import { detectConflicts } from '@/engine/conflicts/detect';
import { applyChanges, evaluateSchedule, generateOptions } from '@/engine/optimization/optimize';
import { planJourney } from '@/engine/routing/journey';
import { metricsCsv } from '@/utils/export';
import type { Project } from '@/types';

/** Submission → conflict → simulation → optimization → approval → citizen notification. */
describe('end-to-end coordination workflow (engine level)', () => {
  it('runs the complete vertical workflow with computed (not hard-coded) results', () => {
    const base = createSeedProjects();
    const demo = createDemoConflictProject();
    const projects = [...base, demo];
    const conflicts = detectConflicts(projects).filter((c) => c.projectIds.includes(demo.id) && c.kind !== 'proximity');
    expect(conflicts.length).toBeGreaterThan(0);
    const c = conflicts.find((x) => x.projectIds.includes('RASD-P01'))!;
    const r = generateOptions(c, projects);
    const best = r.options.find((o) => o.recommended)!;
    expect(best.feasible).toBe(true);
    let after: Project[] = applyChanges(projects, best.changes);
    const involved = new Set([...c.projectIds, ...best.changes.map((x) => x.projectId)]);
    after = after.map((p) => (involved.has(p.id) ? { ...p, status: best.changes.some((x) => x.projectId === p.id) ? 'scheduled' : 'approved' } : p));
    expect(detectConflicts(after).some((x) => x.id === c.id)).toBe(false);

    const before = projects.map((p) => ({ ...p, schedule: { ...p.proposed } }));
    const mB = evaluateSchedule(before);
    const mA = evaluateSchedule(after);
    // same model + assumptions: metrics are comparable; the decision changes the schedule only.
    // Totals are reported as computed — a delay can legitimately create other overlaps.
    expect(mA.daily).toHaveLength(mB.daily.length);
    expect(Number.isFinite(mA.vehicleHoursDelay) && Number.isFinite(mB.vehicleHoursDelay)).toBe(true);
    expect(best.metrics!.conflicts).toBe(mA.conflicts);

    // citizen view: approved closure on Project A affects journey J1 on its date
    const j = CITIZEN_JOURNEYS[0];
    const o = PLACES.find((p) => p.id === j.originPlaceId)!;
    const d = PLACES.find((p) => p.id === j.destinationPlaceId)!;
    const plan = planJourney(after, o.nodeId, d.nodeId, j.date, j.hour, false);
    expect(plan.normal).not.toBeNull();
    expect(plan.now).not.toBeNull();
    expect(plan.affecting.map((p) => p.id)).toContain('RASD-P01');
    expect(plan.now!.timeMin).toBeGreaterThanOrEqual(plan.normal!.timeMin - 1e-9);

    // export
    const csv = metricsCsv(mB, mA, after);
    expect(csv).toContain('summary');
    expect(csv.split('\n').filter((l) => l.startsWith('"daily"'))).toHaveLength(92);
    expect(csv).toContain('RASD-D01');
  });
});
