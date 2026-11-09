import type { Project } from '@/types';
import { detectConflicts } from '@/engine/conflicts/detect';

/** Pure status derivation (same rule as the app store, without browser storage). */
export function syncStatusesPure(projects: Project[]): Project[] {
  const inConflict = new Set(
    detectConflicts(projects)
      .filter((c) => c.kind !== 'proximity' || c.category === 'sequential')
      .flatMap((c) => c.projectIds),
  );
  return projects.map((p) => (p.status === 'submitted' && inConflict.has(p.id) ? { ...p, status: 'conflict_detected' } : p));
}
