/**
 * Imperative MapLibre wrapper used by the main 3D map, the before/after maps and the
 * citizen map. Owns all RASD layers so React components only push data into it.
 */
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
const rtlPluginUrl = '/vendor/mapbox-gl-rtl-text.js';
import { buffer } from '@turf/turf';
import type { Conflict, LngLat, Project } from '@/types';
import { DISTRICT_NAME_AR, DISTRICT_OUTLINE, NODES, SEGMENTS, STUDY_AREA_VIEW, ZONES, uvToLngLat } from '@/data/network';
import { buildingsGeoJSON, generateBuildings } from '@/data/buildings';
import { ORGANIZATIONS } from '@/data/organizations';
import { closureLine, projectMidpoint } from '@/engine/spatial/geometry';
import { vehiclePositions, type VehicleSet } from '@/engine/traffic/vehicles';
import { KIT_BASE_PATH, assignKitModels, loadKitManifest, replacedBuildingIds } from '@/data/kitbash';
import { buildKitGroup, type LoadedKit } from './kitScene';
import { createKitLayer, KIT_LAYER_ID } from './KitbashLayer';
import { offlineStyle, styleFor, terrainAvailable, TERRAIN_ENCODING, TERRAIN_TILES, type BaseStyle } from './styles';

let rtlRequested = false;
function ensureRtl() {
  if (rtlRequested) return;
  rtlRequested = true;
  try {
    if (maplibregl.getRTLTextPluginStatus() === 'unavailable') void maplibregl.setRTLTextPlugin(rtlPluginUrl, true).catch(() => {});
  } catch {
    /* plugin optional */
  }
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
let BUILDINGS_CACHE: ReturnType<typeof buildingsGeoJSON> | null = null;
const offlineBuildings = () => (BUILDINGS_CACHE ??= buildingsGeoJSON(generateBuildings()));

export type KitStatus = { state: 'none' | 'loading' | 'ready' | 'error'; name?: string; models?: number; instances?: number; message?: string };

const KIT_URL = `/${KIT_BASE_PATH}`;
let manifestPromise: ReturnType<typeof loadKitManifest> | null = null;
const kitManifest = () => (manifestPromise ??= loadKitManifest(KIT_URL));

export interface RasdMapOptions {
  style: BaseStyle;
  interactive?: boolean;
  initialView?: { center: LngLat; zoom: number; pitch?: number; bearing?: number };
  onSegmentClick?: (segmentId: string, lngLat: LngLat) => void;
  onMapClick?: (lngLat: LngLat) => void;
  onProjectClick?: (projectId: string) => void;
  onConflictClick?: (conflictId: string) => void;
  onFallback?: (reason: string) => void;
  onReady?: () => void;
  onKit?: (s: KitStatus) => void;
  labels?: boolean;
  vehicleCount?: number;
}

export { DEFAULT_OVERLAYS, type Overlays } from './overlays';
import { DEFAULT_OVERLAYS, type Overlays } from './overlays';

type Data = Record<string, GeoJSON.FeatureCollection>;

export class RasdMap {
  map: MLMap;
  private opts: RasdMapOptions;
  private data: Data = {};
  private markers: maplibregl.Marker[] = [];
  private conflictMarkers: maplibregl.Marker[] = [];
  private labelMarkers: maplibregl.Marker[] = [];
  private vehicles: VehicleSet | null = null;
  private raf = 0;
  private lastVehUpdate = 0;
  private anim: 'none' | 'orbit' | 'follow' | 'tour' = 'none';
  private animRaf = 0;
  private tourTimer: ReturnType<typeof setTimeout> | null = null;
  private overlays: Overlays = { ...DEFAULT_OVERLAYS };
  private is3D = true;
  private styleName: BaseStyle;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  usingFallback = false;
  ready = false;
  private destroyed = false;
  private reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** Automated browsers (tests) run software WebGL: animate vehicles at a lower rate. */
  private frameMs = typeof navigator !== 'undefined' && navigator.webdriver ? 250 : 50;
  private paused = false;
  private kit: LoadedKit | null = null;
  /** set on 'style.load' (map.isStyleLoaded() is false while any geojson source is updating) */
  private styleReady = false;
  private kitHidden = new Set<string>();

  constructor(container: HTMLElement, opts: RasdMapOptions) {
    ensureRtl();
    this.opts = opts;
    this.styleName = opts.style;
    const v = opts.initialView ?? STUDY_AREA_VIEW;
    this.map = new maplibregl.Map({
      container,
      style: styleFor(opts.style),
      center: v.center,
      zoom: v.zoom,
      pitch: v.pitch ?? 55,
      bearing: v.bearing ?? -25,
      maxPitch: 78,
      interactive: opts.interactive ?? true,
      attributionControl: { compact: true, customAttribution: 'RASD simulation · © OpenStreetMap contributors' },
      canvasContextAttributes: { antialias: true },
    });
    this.armFallback();
    this.map.on('style.load', () => {
      this.styleReady = true;
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
      this.installLayers();
      if (!this.ready) {
        this.ready = true;
        opts.onReady?.();
      }
    });
    this.map.on('error', (e) => {
      const msg = String((e as { error?: Error }).error?.message ?? '');
      if (!this.map.isStyleLoaded() && !this.usingFallback && /style|fetch|Failed|NetworkError|load/i.test(msg)) this.useFallback('style-error');
    });
    this.map.on('click', (e) => this.handleClick(e));
    for (const ev of ['mousedown', 'touchstart', 'wheel'] as const) this.map.on(ev, () => this.stopCameraAnimation());
    this.map.on('mousemove', 'rasd-network-hit', () => (this.map.getCanvas().style.cursor = 'pointer'));
    this.map.on('mouseleave', 'rasd-network-hit', () => (this.map.getCanvas().style.cursor = ''));
    this.startVehicleLoop();
    void this.loadKit();
  }

  /** Optional licensed models: only when a valid manifest exists in public/models/kitbash. */
  private async loadKit() {
    const manifest = await kitManifest();
    if (!manifest) {
      this.opts.onKit?.({ state: 'none' });
      return;
    }
    this.opts.onKit?.({ state: 'loading', name: manifest.name });
    try {
      const placements = assignKitModels(manifest);
      const kit = await buildKitGroup(KIT_URL, manifest, placements);
      if (this.destroyed) return;
      if (!kit.models) throw new Error('no model could be loaded');
      this.kit = kit;
      this.kitHidden = replacedBuildingIds(placements);
      this.opts.onKit?.({ state: 'ready', name: manifest.name, models: kit.models, instances: kit.instances });
      if (this.styleReady) this.installKit();
    } catch (e) {
      this.opts.onKit?.({ state: 'error', name: manifest.name, message: e instanceof Error ? e.message : String(e) });
    }
  }

  private installKit() {
    const m = this.map;
    const on = !!this.kit && this.overlays.kitbash && this.overlays.buildings && this.isOfflineStyle;
    if (m.getLayer(KIT_LAYER_ID)) m.removeLayer(KIT_LAYER_ID);
    if (m.getLayer('rasd-buildings-3d')) m.setFilter('rasd-buildings-3d', on ? ['!', ['in', ['get', 'id'], ['literal', [...this.kitHidden]]]] : null);
    if (!on) return;
    // above ground layers (lines don't depth-test) so models occlude the roads behind them
    m.addLayer(createKitLayer(this.kit!), m.getLayer('rasd-pick-line') ? 'rasd-pick-line' : undefined);
  }

  private armFallback() {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    if (this.styleName === 'offline') return;
    this.fallbackTimer = setTimeout(() => {
      if (!this.map.isStyleLoaded()) this.useFallback('timeout');
    }, 6500);
  }

  private useFallback(reason: string) {
    if (this.destroyed || this.usingFallback) return;
    this.usingFallback = true;
    this.styleReady = false;
    this.map.setStyle(offlineStyle('dark'));
    this.opts.onFallback?.(reason);
  }

  setBaseStyle(s: BaseStyle) {
    if (s === this.styleName && !this.usingFallback) return;
    this.styleName = s;
    this.usingFallback = s === 'offline';
    this.styleReady = false;
    this.map.setStyle(styleFor(s) as string | StyleSpecification);
    this.armFallback();
  }

  get isOfflineStyle() {
    return !this.map.getSource('openmaptiles') && !this.map.getSource('sat');
  }

  private installLayers() {
    const m = this.map;
    const offline = this.isOfflineStyle;
    const add = (id: string) => {
      if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: this.data[id] ?? EMPTY });
    };
    if (offline && !m.getSource('rasd-buildings')) m.addSource('rasd-buildings', { type: 'geojson', data: offlineBuildings() });
    if (!m.getSource('rasd-network-static'))
      m.addSource('rasd-network-static', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: SEGMENTS.map((s) => ({ type: 'Feature', properties: { id: s.id, cls: s.roadClass, name: s.name }, geometry: { type: 'LineString', coordinates: s.coords } })),
        },
      });
    if (offline) {
      if (m.getLayer('rasd-ground-roads')) m.removeLayer('rasd-ground-roads');
      m.addLayer({
        id: 'rasd-ground-roads',
        type: 'line',
        source: 'rasd-network-static',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#111d42',
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, ['match', ['get', 'cls'], 'motorway', 4, 'connector', 0.5, 2], 16, ['match', ['get', 'cls'], 'motorway', 70, 'connector', 6, 40]],
        },
      });
      m.addLayer({
        id: 'rasd-buildings-3d',
        type: 'fill-extrusion',
        source: 'rasd-buildings',
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height'], 0, '#16234a', 30, '#1d2f5e', 90, '#2a3f7a', 200, '#4a4fa8'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      });
    } else if (m.getSource('openmaptiles') && !m.getLayer('building-3d') && !m.getLayer('rasd-osm-buildings')) {
      const dark = this.styleName !== 'light';
      m.addLayer({
        id: 'rasd-osm-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 12.5,
        paint: {
          'fill-extrusion-color': dark ? ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#1d2a3d', 60, '#2b4263', 200, '#3e6694'] : '#d6dde7',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      });
    }
    if (!m.getSource('rasd-district'))
      m.addSource('rasd-district', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: DISTRICT_OUTLINE } } });
    m.addLayer({ id: 'rasd-district-line', type: 'line', source: 'rasd-district', paint: { 'line-color': '#8b7bff', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [3, 2] } });
    for (const id of ['rasd-network', 'rasd-closures', 'rasd-workzones', 'rasd-conflict-links', 'rasd-highlight', 'rasd-routes', 'rasd-vehicles', 'rasd-overlap', 'rasd-pick']) add(id);

    m.addLayer({
      id: 'rasd-network-casing',
      type: 'line',
      source: 'rasd-network',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#020617', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 16] },
    });
    m.addLayer({
      id: 'rasd-network-line',
      type: 'line',
      source: 'rasd-network',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['==', ['get', 'traffic'], 1], ['interpolate', ['linear'], ['get', 'vc'], 0, '#10b981', 0.6, '#84cc16', 0.85, '#f59e0b', 1.05, '#ef4444', 1.4, '#991b1b'], '#22d3ee'],
        'line-opacity': ['case', ['==', ['get', 'closed'], 1], 0.15, ['==', ['get', 'cls'], 'connector'], 0.35, 0.85],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['match', ['get', 'cls'], 'motorway', 2.5, 'connector', 0.6, 1.6], 16, ['match', ['get', 'cls'], 'motorway', 10, 'connector', 2, 6]],
      },
    });
    m.addLayer({ id: 'rasd-network-hit', type: 'line', source: 'rasd-network', paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 22 }, filter: ['==', ['get', 'closable'], 1] });
    m.addLayer({
      id: 'rasd-highlight-glow',
      type: 'line',
      source: 'rasd-highlight',
      paint: { 'line-color': '#ef4444', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 40], 'line-blur': 10, 'line-opacity': 0.55 },
    });
    m.addLayer({
      id: 'rasd-routes-line',
      type: 'line',
      source: 'rasd-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'kind'], 'recommended', '#22d3ee', 'blocked', '#ef4444', 'detour', '#34d399', '#94a3b8'],
        'line-width': ['match', ['get', 'kind'], 'recommended', 7, 'detour', 6, 5],
        'line-opacity': 0.95,
        'line-dasharray': ['match', ['get', 'kind'], 'original', ['literal', [1.5, 1.2]], 'blocked', ['literal', [1, 1]], ['literal', [1, 0]]],
      },
    });
    m.addLayer({
      id: 'rasd-closures-glow',
      type: 'line',
      source: 'rasd-closures',
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 34], 'line-blur': 8, 'line-opacity': ['*', 0.5, ['get', 'alpha']] },
    });
    m.addLayer({
      id: 'rasd-closures-line',
      type: 'line',
      source: 'rasd-closures',
      layout: { 'line-cap': 'butt' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 12],
        'line-opacity': ['get', 'alpha'],
        'line-dasharray': [2, 1],
      },
    });
    m.addLayer({
      id: 'rasd-overlap-line',
      type: 'line',
      source: 'rasd-overlap',
      paint: { 'line-color': '#fecaca', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 6], 'line-opacity': 0.95 },
    });
    m.addLayer({
      id: 'rasd-workzones-3d',
      type: 'fill-extrusion',
      source: 'rasd-workzones',
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.85 },
    });
    m.addLayer({
      id: 'rasd-conflict-links-line',
      type: 'line',
      source: 'rasd-conflict-links',
      paint: { 'line-color': ['match', ['get', 'severity'], 'high', '#ef4444', 'medium', '#f59e0b', '#fbbf24'], 'line-width': 2, 'line-dasharray': [1, 1.5], 'line-opacity': 0.85 },
    });
    m.addLayer({
      id: 'rasd-vehicles-dot',
      type: 'circle',
      source: 'rasd-vehicles',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 15, 3.2, 17, 5],
        'circle-color': ['interpolate', ['linear'], ['get', 's'], 0.15, '#ef4444', 0.45, '#f59e0b', 0.8, '#e2e8f0'],
        'circle-opacity': 0.95,
        'circle-blur': 0.15,
      },
    });
    m.addLayer({
      id: 'rasd-pick-line',
      type: 'line',
      source: 'rasd-pick',
      paint: { 'line-color': '#facc15', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 14], 'line-opacity': 0.95 },
    });
    m.addLayer({
      id: 'rasd-pick-pt',
      type: 'circle',
      source: 'rasd-pick',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 7, 'circle-color': '#facc15', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 2 },
    });
    if (this.overlays.terrain) this.applyTerrain(true);
    this.applyOverlays();
    this.applyLabels();
    if (this.kit) this.installKit();
  }

  private handleClick(e: maplibregl.MapMouseEvent) {
    const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    this.opts.onMapClick?.(ll);
    if (!this.opts.onSegmentClick || !this.map.getLayer('rasd-network-hit')) return;
    const f = this.map.queryRenderedFeatures(e.point, { layers: ['rasd-network-hit'] })[0];
    if (f?.properties?.id) this.opts.onSegmentClick(String(f.properties.id), ll);
  }

  private setData(id: string, fc: GeoJSON.FeatureCollection) {
    this.data[id] = fc;
    const src = this.map.getSource(id) as GeoJSONSource | undefined;
    src?.setData(fc);
  }

  // ───────────────────────── data setters ─────────────────────────
  setNetwork(vcBySeg: Map<string, number> | null, closed: Set<string>) {
    this.setData('rasd-network', {
      type: 'FeatureCollection',
      features: SEGMENTS.map((s) => ({
        type: 'Feature',
        properties: {
          id: s.id,
          name: s.name,
          cls: s.roadClass,
          closable: s.closable ? 1 : 0,
          vc: vcBySeg ? (Number.isFinite(vcBySeg.get(s.id)!) ? vcBySeg.get(s.id)! : 2) : 0,
          traffic: vcBySeg && this.overlays.traffic ? 1 : 0,
          closed: closed.has(s.id) ? 1 : 0,
        },
        geometry: { type: 'LineString', coordinates: s.coords },
      })),
    });
  }

  setClosures(projects: Project[], opts: { activeIds: Set<string>; conflictIds: Set<string>; selectedId?: string | null; is3D?: boolean }) {
    const features: GeoJSON.Feature[] = [];
    const zones: GeoJSON.Feature[] = [];
    for (const p of projects) {
      const active = opts.activeIds.has(p.id);
      const color = opts.conflictIds.has(p.id)
        ? '#ef4444'
        : p.status === 'approved' || p.status === 'scheduled'
          ? '#10b981'
          : p.status === 'rejected'
            ? '#64748b'
            : '#f59e0b';
      const alpha = p.id === opts.selectedId ? 1 : active ? 0.95 : 0.38;
      for (const c of p.closures) {
        const line = closureLine(c);
        features.push({ ...line, properties: { projectId: p.id, color, alpha } });
        if (active && p.status !== 'rejected') {
          try {
            const poly = buffer(line, 0.012, { units: 'kilometers' });
            if (poly) zones.push({ ...poly, properties: { color: ORGANIZATIONS[p.orgId].color, h: opts.is3D === false ? 0 : 5 } });
          } catch {
            /* ignore degenerate */
          }
        }
      }
    }
    this.setData('rasd-closures', { type: 'FeatureCollection', features });
    this.setData('rasd-workzones', { type: 'FeatureCollection', features: zones });
  }

  setOverlap(lines: GeoJSON.Feature[]) {
    this.setData('rasd-overlap', { type: 'FeatureCollection', features: lines });
  }

  setHighlight(segmentIds: string[]) {
    const segs = SEGMENTS.filter((s) => segmentIds.includes(s.id));
    this.setData('rasd-highlight', {
      type: 'FeatureCollection',
      features: segs.map((s) => ({ type: 'Feature', properties: { id: s.id }, geometry: { type: 'LineString', coordinates: s.coords } })),
    });
  }

  setPick(fc: GeoJSON.FeatureCollection) {
    this.setData('rasd-pick', fc);
  }

  setRoutes(fc: GeoJSON.FeatureCollection) {
    this.setData('rasd-routes', fc);
  }

  setConflicts(conflicts: Conflict[], projects: Project[], onClick?: (id: string) => void) {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const links: GeoJSON.Feature[] = [];
    this.conflictMarkers.forEach((m) => m.remove());
    this.conflictMarkers = [];
    const visible = conflicts.filter((c) => c.kind !== 'proximity' || c.category === 'sequential');
    for (const c of visible) {
      const a = byId.get(c.projectIds[0]);
      const b = byId.get(c.projectIds[1]);
      if (!a || !b) continue;
      const pa = projectMidpoint(a);
      const pb = projectMidpoint(b);
      const mid: LngLat = [(pa[0] + pb[0]) / 2 + (pb[1] - pa[1]) * 0.15, (pa[1] + pb[1]) / 2 - (pb[0] - pa[0]) * 0.15];
      const arc: LngLat[] = [];
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const x = (1 - t) * (1 - t) * pa[0] + 2 * (1 - t) * t * mid[0] + t * t * pb[0];
        const y = (1 - t) * (1 - t) * pa[1] + 2 * (1 - t) * t * mid[1] + t * t * pb[1];
        arc.push([x, y]);
      }
      links.push({ type: 'Feature', properties: { id: c.id, severity: c.severity }, geometry: { type: 'LineString', coordinates: arc } });
      if (this.overlays.conflicts) {
        const el = document.createElement('button');
        el.className = `rasd-conflict-marker sev-${c.severity}`;
        el.setAttribute('aria-label', `تعارض ${c.id}`);
        el.dataset.conflictId = c.id;
        el.innerHTML = '<span class="ring"></span><span class="core">!</span>';
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          (onClick ?? this.opts.onConflictClick)?.(c.id);
        });
        this.conflictMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(c.location).addTo(this.map));
      }
    }
    this.setData('rasd-conflict-links', { type: 'FeatureCollection', features: this.overlays.conflicts ? links : [] });
  }

  setProjectMarkers(projects: Project[], opts: { selectedId?: string | null; activeIds: Set<string>; conflictIds: Set<string> }) {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    if (!this.overlays.projects) return;
    for (const p of projects) {
      const el = document.createElement('button');
      const org = ORGANIZATIONS[p.orgId];
      el.className = `rasd-project-marker ${p.id === opts.selectedId ? 'selected' : ''} ${opts.activeIds.has(p.id) ? 'active' : 'inactive'} ${opts.conflictIds.has(p.id) ? 'conflict' : ''}`;
      el.style.setProperty('--org', org.color);
      el.dataset.projectId = p.id;
      el.innerHTML = `<span class="dot"></span><span class="lbl">${org.short}</span><span class="card"><b>${escapeHtml(p.title)}</b><small>${escapeHtml(org.ar)}</small><small>${p.schedule.start} → ${p.schedule.end}</small></span>`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.opts.onProjectClick?.(p.id);
      });
      this.markers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(projectMidpoint(p)).addTo(this.map));
    }
  }

  private applyLabels() {
    this.labelMarkers.forEach((m) => m.remove());
    this.labelMarkers = [];
    if (this.opts.labels === false || !this.overlays.neighborhoods) return;
    {
      const el = document.createElement('div');
      el.className = 'rasd-label district';
      el.textContent = `${DISTRICT_NAME_AR} — نطاق المحاكاة`;
      this.labelMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(uvToLngLat(-3.2, 0.6)).addTo(this.map));
    }
    for (const z of ZONES) {
      const el = document.createElement('div');
      el.className = z.id === 'Z-KINGDOM' || z.id === 'Z-FAISALIAH' ? 'rasd-label landmark' : 'rasd-label';
      el.textContent = z.name;
      this.labelMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(z.coord).addTo(this.map));
    }
    if (this.isOfflineStyle) {
      // road names (HTML so Arabic shaping works without glyph servers)
      const seen = new Set<string>();
      for (const s of SEGMENTS) {
        if (!s.closable || seen.has(s.roadId)) continue;
        if (!['KFR-MAK-THL', 'OLY-THL-URB', 'MAK-KFR-OLY', 'THL-KFR-OLY', 'URB-KFR-OLY'].includes(s.id)) continue;
        seen.add(s.roadId);
        const mid: LngLat = [(s.coords[0][0] + s.coords[s.coords.length - 1][0]) / 2, (s.coords[0][1] + s.coords[s.coords.length - 1][1]) / 2];
        const el = document.createElement('div');
        el.className = 'rasd-label road';
        el.textContent = s.name;
        this.labelMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(this.map));
      }
    }
  }

  setVehicles(set: VehicleSet | null) {
    this.vehicles = set;
  }

  /** Stop per-frame updates while the map is hidden behind a full-page view. */
  setPaused(p: boolean) {
    this.paused = p;
  }

  setOverlays(o: Overlays) {
    const prev = this.overlays;
    this.overlays = { ...o };
    if (prev.terrain !== o.terrain) this.applyTerrain(o.terrain);
    if ((prev.kitbash !== o.kitbash || prev.buildings !== o.buildings) && this.kit && this.styleReady) this.installKit();
    this.applyOverlays();
    if (prev.neighborhoods !== o.neighborhoods) this.applyLabels();
  }

  private applyTerrain(on: boolean) {
    if (!terrainAvailable()) return;
    const m = this.map;
    if (on) {
      if (!m.getSource('rasd-dem'))
        m.addSource('rasd-dem', { type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 256, encoding: TERRAIN_ENCODING });
      m.setTerrain({ source: 'rasd-dem', exaggeration: 1.5 });
    } else m.setTerrain(null);
  }

  private applyOverlays() {
    const vis = (id: string, on: boolean) => this.map.getLayer(id) && this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    const o = this.overlays;
    vis('rasd-buildings-3d', o.buildings);
    vis('rasd-osm-buildings', o.buildings);
    vis('building-3d', o.buildings);
    for (const l of ['rasd-closures-glow', 'rasd-closures-line', 'rasd-workzones-3d', 'rasd-overlap-line']) vis(l, o.closures);
    vis('rasd-vehicles-dot', o.vehicles);
    vis('rasd-conflict-links-line', o.conflicts);
    vis('rasd-highlight-glow', o.conflicts);
    this.conflictMarkers.forEach((m) => (m.getElement().style.display = o.conflicts ? '' : 'none'));
    this.markers.forEach((m) => (m.getElement().style.display = o.projects ? '' : 'none'));
    if (this.data['rasd-network']) {
      const fc = this.data['rasd-network'];
      fc.features.forEach((f) => (f.properties!.traffic = o.traffic && f.properties!.vc !== undefined ? 1 : 0));
      this.setData('rasd-network', fc);
    }
  }

  // ───────────────────────── vehicles ─────────────────────────
  private startVehicleLoop() {
    const tick = (now: number) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(tick);
      if (this.paused || now - this.lastVehUpdate < (this.reduceMotion ? 1000 : this.frameMs)) return;
      this.lastVehUpdate = now;
      if (!this.vehicles || !this.overlays.vehicles || !this.map.getSource('rasd-vehicles')) return;
      const pts = vehiclePositions(this.vehicles, this.reduceMotion ? 0 : now / 1000);
      (this.map.getSource('rasd-vehicles') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: pts.map((p) => ({ type: 'Feature', properties: { s: p[2] }, geometry: { type: 'Point', coordinates: [p[0], p[1]] } })),
      });
      if (this.anim === 'follow' && pts[0]) this.map.jumpTo({ center: [pts[0][0], pts[0][1]] });
    };
    this.raf = requestAnimationFrame(tick);
  }

  // ───────────────────────── camera ─────────────────────────
  stopCameraAnimation() {
    this.anim = 'none';
    cancelAnimationFrame(this.animRaf);
    if (this.tourTimer) clearTimeout(this.tourTimer);
    this.tourTimer = null;
  }

  flyTo(center: LngLat, zoom = 15, opts: { pitch?: number; bearing?: number; duration?: number } = {}) {
    this.stopCameraAnimation();
    this.map.flyTo({
      center,
      zoom,
      pitch: this.is3D ? (opts.pitch ?? 60) : 0,
      bearing: this.is3D ? (opts.bearing ?? this.map.getBearing()) : 0,
      duration: this.reduceMotion ? 0 : (opts.duration ?? 2200),
      essential: true,
    });
  }

  set3D(on: boolean) {
    this.is3D = on;
    this.stopCameraAnimation();
    this.map.easeTo({ pitch: on ? 60 : 0, bearing: on ? -25 : 0, duration: this.reduceMotion ? 0 : 1200 });
    if (this.map.getLayer('rasd-buildings-3d')) this.map.setPaintProperty('rasd-buildings-3d', 'fill-extrusion-height', on ? ['get', 'height'] : 0);
    if (this.map.getLayer('rasd-osm-buildings')) this.map.setPaintProperty('rasd-osm-buildings', 'fill-extrusion-height', on ? ['coalesce', ['get', 'render_height'], 8] : 0);
    this.map.dragRotate[on ? 'enable' : 'disable']();
  }

  zoomBy(d: number) {
    this.map.easeTo({ zoom: this.map.getZoom() + d, duration: 300 });
  }
  rotateBy(d: number) {
    this.map.easeTo({ bearing: this.map.getBearing() + d, duration: 400 });
  }
  pitchBy(d: number) {
    this.map.easeTo({ pitch: Math.max(0, Math.min(78, this.map.getPitch() + d)), duration: 400 });
  }

  reset() {
    this.stopCameraAnimation();
    this.map.flyTo({ center: STUDY_AREA_VIEW.center, zoom: STUDY_AREA_VIEW.zoom, pitch: this.is3D ? STUDY_AREA_VIEW.pitch : 0, bearing: this.is3D ? STUDY_AREA_VIEW.bearing : 0, duration: this.reduceMotion ? 0 : 1800 });
  }

  orbit(center?: LngLat) {
    this.stopCameraAnimation();
    if (center) this.map.jumpTo({ center });
    this.anim = 'orbit';
    let last = performance.now();
    const step = (now: number) => {
      if (this.anim !== 'orbit') return;
      const dt = now - last;
      last = now;
      this.map.setBearing(this.map.getBearing() + dt * 0.012);
      this.animRaf = requestAnimationFrame(step);
    };
    this.animRaf = requestAnimationFrame(step);
  }

  follow() {
    this.stopCameraAnimation();
    this.anim = 'follow';
    this.map.easeTo({ zoom: 16, pitch: 65, duration: 800 });
  }

  tour(onDone?: () => void) {
    this.stopCameraAnimation();
    this.anim = 'tour';
    // single-district tour: حي العليا only
    const stops: { center: LngLat; zoom: number; pitch: number; bearing: number; hold: number }[] = [
      { center: STUDY_AREA_VIEW.center, zoom: 13.3, pitch: 35, bearing: -25, hold: 2200 },
      { center: [46.6744, 24.7114], zoom: 15.4, pitch: 68, bearing: -40, hold: 3000 },
      { center: uvToLngLat(-1.5, 0.1), zoom: 15.2, pitch: 64, bearing: 20, hold: 3000 },
      { center: [46.6853, 24.6903], zoom: 15.3, pitch: 65, bearing: 60, hold: 3000 },
      { ...STUDY_AREA_VIEW, hold: 1500 },
    ];
    let i = 0;
    const next = () => {
      if (this.anim !== 'tour') return;
      if (i >= stops.length) {
        this.anim = 'none';
        onDone?.();
        return;
      }
      const s = stops[i++];
      this.map.flyTo({ center: s.center, zoom: s.zoom, pitch: this.is3D ? s.pitch : 0, bearing: s.bearing, duration: this.reduceMotion ? 0 : 3000, essential: true });
      this.tourTimer = setTimeout(next, (this.reduceMotion ? 0 : 3000) + s.hold);
    };
    next();
  }

  getCamera() {
    return { center: this.map.getCenter().toArray() as LngLat, zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing() };
  }

  jumpTo(c: { center: LngLat; zoom: number; pitch: number; bearing: number }) {
    this.map.jumpTo(c);
  }

  resize() {
    this.map.resize();
  }

  setPadding(p: { left: number; right: number; top: number; bottom: number }) {
    this.map.easeTo({ padding: p, duration: this.reduceMotion ? 0 : 500 });
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.stopCameraAnimation();
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.markers.forEach((m) => m.remove());
    this.conflictMarkers.forEach((m) => m.remove());
    this.labelMarkers.forEach((m) => m.remove());
    this.map.remove();
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const NODE_COUNT = NODES.length;
