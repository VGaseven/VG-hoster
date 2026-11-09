import { useEffect, useMemo, useRef } from 'react';
import type { LngLat, Project } from '@/types';
import { RasdMap } from './RasdMap';
import { useStore } from '@/store/store';
import { actionable, activeAt, getConflicts, useSnapshot } from '@/store/derived';
import { vehicleSet } from '@/engine/traffic/vehicles';

interface Props {
  projects: Project[];
  day: number;
  hour: number;
  onReady?: (m: RasdMap) => void;
  routes?: GeoJSON.FeatureCollection;
  initialView?: { center: LngLat; zoom: number; pitch?: number; bearing?: number };
  showConflicts?: boolean;
  vehicles?: number;
  testid?: string;
}

/** Self-contained simulation map (used for before/after and citizen views). */
export function SimMap({ projects, day, hour, onReady, routes, initialView, showConflicts = true, vehicles = 220, testid }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<RasdMap | null>(null);
  const ready = useRef(false);
  const baseStyle = useStore((s) => s.baseStyle);
  const snap = useSnapshot(projects, day, hour);
  const act = useMemo(() => activeAt(projects, day, Math.floor(hour)), [projects, day, hour]);
  const conflicts = useMemo(() => (showConflicts ? actionable(getConflicts(projects)) : []), [projects, showConflicts]);
  const cids = useMemo(() => new Set(conflicts.flatMap((c) => c.projectIds)), [conflicts]);
  const latest = useRef({ projects, snap, act, cids, conflicts, routes });
  latest.current = { projects, snap, act, cids, conflicts, routes };

  const push = () => {
    const m = mapRef.current;
    if (!m || !ready.current) return;
    const L = latest.current;
    m.setNetwork(L.snap.result.vcBySeg, new Set([...L.snap.effects.entries()].filter(([, e]) => e.full).map(([k]) => k)));
    m.setClosures(L.projects, { activeIds: L.act, conflictIds: L.cids, is3D: true });
    m.setProjectMarkers(L.projects.filter((p) => L.act.has(p.id)), { activeIds: L.act, conflictIds: L.cids });
    m.setConflicts(L.conflicts.filter((c) => c.projectIds.every((id) => L.act.has(id))), L.projects);
    m.setVehicles(vehicles ? vehicleSet(L.snap.result, vehicles) : null);
    if (L.routes) m.setRoutes(L.routes);
  };

  useEffect(() => {
    if (!ref.current) return;
    const m = new RasdMap(ref.current, {
      style: useStore.getState().baseStyle,
      initialView,
      labels: true,
      onReady: () => {
        ready.current = true;
        push();
        onReady?.(m);
      },
    });
    mapRef.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      m.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(push, [snap, act, cids, conflicts, routes, projects]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => mapRef.current?.setBaseStyle(baseStyle), [baseStyle]);

  return (
    <div className="absolute inset-0" data-testid={testid}>
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
