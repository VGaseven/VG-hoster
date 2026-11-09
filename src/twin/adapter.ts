/**
 * RASD data adapter — one stable interface between data and the 3D runtime.
 *
 *   LocalDemoSource  → DEMO DATA / SIMULATED (default, offline)
 *   CodexApiSource   → future Codex backend (FastAPI + PostGIS). Enabled only when
 *                      VITE_CODEX_API_URL is set. Endpoint paths are PLACEHOLDERS until Codex
 *                      publishes docs/CLAUDE_INTEGRATION.md; on any error it falls back to demo data.
 *
 * Rendering code depends only on these types, never on a concrete source.
 */
import { TWIN_ROADS, NODE_BY, type TwinRoad } from './layout';

export interface RoadSegment {
  id: string;
  nameAr: string;
  nameEn: string;
  lanesPerDirection: number;
  speedKmh: number;
  /** local metres [x, z] (stylised scene); a real backend would add WGS84 geometry */
  geometry: [number, number][];
  kind: TwinRoad['kind'];
}

export interface Excavation {
  id: string;
  titleAr: string;
  ownerAr: string;
  roadId: string;
  /** fraction along the road (0..1) */
  from: number;
  to: number;
  lanesClosed: number;
  start: string;
  end: string;
  latestEnd: string;
  flexible: boolean;
}

export interface TrafficEvent {
  id: string;
  type: 'closure' | 'congestion' | 'incident';
  roadId: string;
  at: string;
  severity: number;
  source: 'demo' | 'codex' | 'waze' | 'balady' | 'municipality';
}

export interface CongestionObservation {
  roadId: string;
  at: string;
  vc: number;
  speedKmh: number;
  source: TrafficEvent['source'];
}

export interface ConflictResult {
  id: string;
  projectIds: [string, string];
  kind: 'same-road' | 'detour';
  overlapStart: string;
  overlapEnd: string;
  overlapDays: number;
  divertedVehPerHour: number;
  congestionIncreasePct: number;
  explanationAr: string;
}

export interface RouteAlternative {
  odKey: string;
  roadIds: string[];
  minutes: number;
}

export interface TwinMetrics {
  activeExcavations: number;
  activeClosures: number;
  detectedConflicts: number;
  affectedRoadIds: string[];
  maxVc: number;
  congestionIndex: number;
  delayVehHours: number;
  avgDelayMin: number;
  reroutedVehPerHour: number;
  /** trip time along the main corridor (south → north), minutes */
  corridorTripMin: number;
  corridorTripMinNormal: number;
}

export interface HistoricalState {
  at: string;
  labelAr: string;
  active: string[];
}

export interface TwinDataSource {
  readonly name: string;
  readonly synthetic: boolean;
  loadRoads(): Promise<RoadSegment[]>;
  loadExcavations(): Promise<Excavation[]>;
  loadHistory(): Promise<HistoricalState[]>;
  /** real-time updates (no-op for demo data) */
  subscribe(onEvent: (e: TrafficEvent) => void): () => void;
}

export const DEMO_EXCAVATIONS: Excavation[] = [
  {
    id: 'EXC-A',
    titleAr: 'تجديد خط مياه رئيسي',
    ownerAr: 'مرفق المياه (افتراضي)',
    roadId: 'A-1',
    from: 0.3,
    to: 0.72,
    lanesClosed: 2,
    start: '2026-12-06',
    end: '2026-12-24',
    latestEnd: '2027-01-31',
    flexible: false,
  },
  {
    id: 'EXC-B',
    titleAr: 'تمديد كيابل ألياف بصرية',
    ownerAr: 'مزود اتصالات (افتراضي)',
    roadId: 'B-1',
    from: 0.25,
    to: 0.65,
    lanesClosed: 1,
    start: '2026-12-12',
    end: '2026-12-28',
    latestEnd: '2027-02-15',
    flexible: true,
  },
];

export const DEMO_HISTORY: HistoricalState[] = [
  { at: '2026-12-01', labelAr: 'حركة طبيعية', active: [] },
  { at: '2026-12-06', labelAr: 'بدء الحفرية أ', active: ['EXC-A'] },
  { at: '2026-12-12', labelAr: 'بدء الحفرية ب — تعارض', active: ['EXC-A', 'EXC-B'] },
  { at: '2026-12-18', labelAr: 'ذروة الازدحام', active: ['EXC-A', 'EXC-B'] },
  { at: '2026-12-25', labelAr: 'انتهاء الحفرية أ', active: ['EXC-B'] },
  { at: '2026-12-29', labelAr: 'انتهاء الأعمال', active: [] },
];

export class LocalDemoSource implements TwinDataSource {
  readonly name = 'DEMO DATA / SIMULATED';
  readonly synthetic = true;
  async loadRoads(): Promise<RoadSegment[]> {
    return TWIN_ROADS.map((r) => ({
      id: r.id,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      lanesPerDirection: r.lanes,
      speedKmh: r.speedKmh,
      kind: r.kind,
      geometry: [NODE_BY.get(r.from)!.p, NODE_BY.get(r.to)!.p],
    }));
  }
  async loadExcavations() {
    return DEMO_EXCAVATIONS.map((e) => ({ ...e }));
  }
  async loadHistory() {
    return DEMO_HISTORY;
  }
  subscribe() {
    return () => {};
  }
}

/**
 * Placeholder client for Codex's backend. Paths below are ASSUMPTIONS (not a working API):
 * GET {base}/segments, GET {base}/excavations, GET {base}/history, WS {base}/events.
 * Any failure falls back to demo data so the prototype never blocks on the network.
 */
export class CodexApiSource implements TwinDataSource {
  readonly name = 'Codex API';
  readonly synthetic = false;
  private fallback = new LocalDemoSource();
  constructor(private base: string) {}
  private async get<T>(path: string, fb: () => Promise<T>): Promise<T> {
    try {
      const r = await fetch(`${this.base.replace(/\/$/, '')}${path}`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as T;
    } catch {
      return fb();
    }
  }
  loadRoads() {
    return this.get('/segments', () => this.fallback.loadRoads());
  }
  loadExcavations() {
    return this.get('/excavations', () => this.fallback.loadExcavations());
  }
  loadHistory() {
    return this.get('/history', () => this.fallback.loadHistory());
  }
  subscribe(onEvent: (e: TrafficEvent) => void) {
    try {
      const ws = new WebSocket(`${this.base.replace(/^http/, 'ws').replace(/\/$/, '')}/events`);
      ws.onmessage = (m) => onEvent(JSON.parse(String(m.data)) as TrafficEvent);
      return () => ws.close();
    } catch {
      return () => {};
    }
  }
}

export function createDataSource(): TwinDataSource {
  const url = (import.meta.env?.VITE_CODEX_API_URL as string | undefined) ?? '';
  return url ? new CodexApiSource(url) : new LocalDemoSource();
}
