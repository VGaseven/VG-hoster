import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useStore, simDayOf, simHourOf } from '@/store/store';
import { actionable, activeAt, beforeProjects, getConflicts, useSnapshot } from '@/store/derived';
import { RasdMap } from './RasdMap';
import { vehicleSet } from '@/engine/traffic/vehicles';
import { closureLine, overlapFeatures } from '@/engine/spatial/geometry';
import { snapToSegment } from '@/engine/spatial/geometry';
import { SEGMENT_BY_ID } from '@/data/network';
import { along, length } from '@turf/turf';

/** The persistent main digital-twin map (stays mounted across routes). */
export function MainMap() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<RasdMap | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const routeRef = useRef(location.pathname);
  routeRef.current = location.pathname;

  const allProjects = useStore((s) => s.projects);
  const viewMode = useStore((s) => s.viewMode);
  const simTime = useStore((s) => s.simTime);
  const overlays = useStore((s) => s.overlays);
  const baseStyle = useStore((s) => s.baseStyle);
  const is3D = useStore((s) => s.is3D);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectedConflictId = useStore((s) => s.selectedConflictId);
  const highlight = useStore((s) => s.highlightSegments);
  const draft = useStore((s) => s.draft);
  const camera = useStore((s) => s.camera);
  const reducedMotion = useStore((s) => s.reducedMotion);

  const projects = viewMode === 'before' ? beforeProjects(allProjects) : allProjects;
  const day = simDayOf(simTime);
  const hour = simHourOf(simTime);
  const conflicts = useMemo(() => actionable(getConflicts(projects)), [projects]);
  const snap = useSnapshot(projects, day, hour);
  const activeIds = useMemo(() => activeAt(projects, day, Math.floor(hour)), [projects, day, hour]);
  const conflictIds = useMemo(() => new Set(conflicts.flatMap((c) => c.projectIds)), [conflicts]);
  const ready = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    const m = new RasdMap(ref.current, {
      style: useStore.getState().baseStyle,
      onReady: () => {
        ready.current = true;
        pushAll();
      },
      onFallback: (r) => useStore.getState().setMapFallback(r),
      onKit: (k) => useStore.getState().setKitStatus(k),
      onProjectClick: (id) => {
        useStore.getState().selectProject(id);
      },
      onConflictClick: (id) => {
        const st = useStore.getState();
        st.selectConflict(id);
        if (!routeRef.current.startsWith('/conflicts') && !routeRef.current.startsWith('/optimize')) navigate('/conflicts');
      },
      onSegmentClick: (segId, ll) => {
        const st = useStore.getState();
        if (!routeRef.current.startsWith('/register') || st.draft.pickStage === 'idle') return;
        const snapRes = snapToSegment(ll, 0.5);
        const frac = snapRes && snapRes.segmentId === segId ? snapRes.fraction : 0.5;
        if (st.draft.pickStage === 'segment' || st.draft.segmentId !== segId) {
          st.setDraft({ segmentId: segId, from: Math.max(0, frac - 0.15), to: Math.min(1, frac + 0.15), pickStage: 'end' });
          st.toast({ tone: 'info', title: 'تم اختيار المقطع', body: `${SEGMENT_BY_ID.get(segId)?.name} — انقر مرة أخرى لتحديد نهاية الإغلاق أو عدّل الحدود من النموذج.` });
        } else if (st.draft.pickStage === 'end') {
          const a = Math.min(st.draft.from, frac);
          const b = Math.max(st.draft.from, frac);
          st.setDraft({ from: a, to: b, pickStage: 'idle' });
        }
      },
      vehicleCount: 320,
    });
    mapRef.current = m;
    // test/debug hooks (read-only)
    Object.assign(window as object, { __rasdMap: m, __rasdStore: useStore, __rasdSegments: Object.fromEntries(SEGMENT_BY_ID) });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      m.destroy();
      mapRef.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushAll() {
    const m = mapRef.current;
    if (!m || !ready.current) return;
    const st = useStore.getState();
    const ps = st.viewMode === 'before' ? beforeProjects(st.projects) : st.projects;
    const d = simDayOf(st.simTime);
    const h = simHourOf(st.simTime);
    const sn = snapshotRef.current ?? snap;
    m.setOverlays(st.overlays);
    m.setNetwork(sn.result.vcBySeg, new Set([...sn.effects.entries()].filter(([, e]) => e.full).map(([k]) => k)));
    const act = activeAt(ps, d, Math.floor(h));
    const cs = actionable(getConflicts(ps));
    const cids = new Set(cs.flatMap((c) => c.projectIds));
    m.setClosures(ps, { activeIds: act, conflictIds: cids, selectedId: st.selectedProjectId, is3D: st.is3D });
    m.setProjectMarkers(ps, { selectedId: st.selectedProjectId, activeIds: act, conflictIds: cids });
    m.setConflicts(cs, ps);
    m.setVehicles(vehicleSet(sn.result, st.reducedMotion ? 120 : 320));
  }
  const snapshotRef = useRef(snap);
  snapshotRef.current = snap;

  // network & vehicles follow the simulated clock
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready.current) return;
    m.setNetwork(snap.result.vcBySeg, new Set([...snap.effects.entries()].filter(([, e]) => e.full).map(([k]) => k)));
    m.setVehicles(vehicleSet(snap.result, reducedMotion ? 120 : 320));
  }, [snap, reducedMotion]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready.current) return;
    m.setClosures(projects, { activeIds, conflictIds, selectedId: selectedProjectId, is3D });
    m.setProjectMarkers(projects, { selectedId: selectedProjectId, activeIds, conflictIds });
  }, [projects, activeIds, conflictIds, selectedProjectId, is3D]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready.current) return;
    m.setConflicts(conflicts, projects);
  }, [conflicts, projects, overlays.conflicts]);

  useEffect(() => {
    mapRef.current?.setOverlays(overlays);
  }, [overlays]);

  // pause animation while covered by a full-page view
  useEffect(() => {
    mapRef.current?.setPaused(['/compare', '/citizen', '/analytics', '/studio', '/settings', '/operators', '/twin'].some((p) => location.pathname.startsWith(p)));
  }, [location.pathname]);

  // keep the focus point centred in the visible gap between floating panels
  const panels = useStore((s) => s.panels);
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const full = ['/optimize'].some((p) => location.pathname.startsWith(p));
    m.setPadding({
      top: 60,
      bottom: panels.timeline ? 170 : 70,
      right: full ? 0 : 400,
      left: full ? 0 : panels.right ? 410 : 60,
    });
  }, [panels, location.pathname]);

  useEffect(() => {
    mapRef.current?.setBaseStyle(baseStyle);
  }, [baseStyle]);

  useEffect(() => {
    if (mapRef.current && ready.current) mapRef.current.set3D(is3D);
  }, [is3D]);

  // highlight: explicit segments or the selected conflict
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready.current) return;
    const c = selectedConflictId ? getConflicts(projects).find((x) => x.id === selectedConflictId) : null;
    m.setHighlight(highlight.length ? highlight : (c?.segmentIds ?? []));
    if (c) {
      const byId = new Map(projects.map((p) => [p.id, p]));
      const a = byId.get(c.projectIds[0]);
      const b = byId.get(c.projectIds[1]);
      m.setOverlap(a && b ? overlapFeatures(a, b) : []);
    } else m.setOverlap([]);
  }, [highlight, selectedConflictId, projects]);

  // registration pick preview
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready.current) return;
    if (!draft.segmentId || !location.pathname.startsWith('/register')) {
      m.setPick({ type: 'FeatureCollection', features: [] });
      return;
    }
    const line = closureLine({ segmentId: draft.segmentId, from: draft.from, to: draft.to });
    const km = length(line, { units: 'kilometers' });
    m.setPick({
      type: 'FeatureCollection',
      features: [line, along(line, 0, { units: 'kilometers' }), along(line, km, { units: 'kilometers' })],
    });
  }, [draft, location.pathname]);

  // camera commands
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !camera) return;
    const c = camera.cmd;
    switch (c.type) {
      case 'fly':
        m.flyTo(c.center, c.zoom, { pitch: c.pitch, bearing: c.bearing, duration: c.duration });
        break;
      case 'reset':
        m.reset();
        break;
      case 'tour':
        m.tour();
        break;
      case 'orbit':
        m.orbit(c.center);
        break;
      case 'follow':
        m.follow();
        break;
      case 'stop':
        m.stopCameraAnimation();
        break;
      case 'zoom':
        m.zoomBy(c.delta);
        break;
      case 'rotate':
        m.rotateBy(c.delta);
        break;
      case 'pitch':
        m.pitchBy(c.delta);
        break;
    }
  }, [camera]);

  return (
    <div className="absolute inset-0" data-testid="main-map" aria-label="خريطة الرياض ثلاثية الأبعاد">
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
