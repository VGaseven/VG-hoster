/**
 * RASD 3D prototype — compact "Riyadh-Inspired" 5-block layout (stylised after حي النخيل).
 * NOT a geographically exact reconstruction. Local metres: x = east, z = south (Three.js),
 * y = up. Stable IDs so the scene can later bind to Codex's backend road segments.
 *
 * This file is the single source of truth for: the Three.js runtime, the traffic model, the
 * data adapter (demo data) and the Blender assembly script (exported as JSON).
 */

export type Vec2 = [number, number]; // [x, z]

export interface TwinNode {
  id: string;
  p: Vec2;
  gate?: boolean;
}

export interface TwinRoad {
  id: string;
  nameAr: string;
  nameEn: string;
  /** lanes per direction */
  lanes: number;
  speedKmh: number;
  from: string;
  to: string;
  kind: 'arterial' | 'secondary' | 'local' | 'bridge';
  /** elevation (m) for bridge decks */
  y?: number;
}

export const LANE_W = 3.5;
export const SIDEWALK_W = 4;
export const BRIDGE_Y = 9;

const N = (id: string, x: number, z: number, gate = false): TwinNode => ({ id, p: [x, z], gate });

/** Intersections & gates. North is −z. */
export const TWIN_NODES: TwinNode[] = [
  // طريق الأمير تركي بن عبدالعزيز الأول (arterial, x = 0)
  N('A-S', 0, 560, true),
  N('A1', 0, 300),
  N('A2', 0, 40),
  N('A3', 0, -220),
  N('A-N', 0, -480, true),
  // شارع النخيل (secondary, x = 210) — the natural diversion route
  N('B-S', 210, 560, true),
  N('B1', 210, 300),
  N('B2', 210, 40),
  N('B3', 210, -220),
  N('B-N', 210, -480, true),
  // شارع الوادي (local, x = −190)
  N('W1', -190, 300),
  N('W2', -190, 40),
  N('W3', -190, -220),
  N('E2', 380, 40, true),
  N('W-W', -330, 40, true),
  // bridge: طريق الملك عبدالله (overpass, z = 440)
  N('K-W', -420, 440, true),
  N('K-E', 420, 440, true),
];

const R = (id: string, nameAr: string, nameEn: string, kind: TwinRoad['kind'], lanes: number, speedKmh: number, from: string, to: string, y?: number): TwinRoad => ({ id, nameAr, nameEn, kind, lanes, speedKmh, from, to, y });

export const ROAD_NAMES = {
  arterial: { ar: 'طريق الأمير تركي بن عبدالعزيز الأول', en: 'Prince Turki bin Abdulaziz Al Awwal Rd' },
  secondary: { ar: 'شارع النخيل', en: 'Al Nakheel St' },
  local: { ar: 'شارع الوادي', en: 'Al Wadi St' },
  bridge: { ar: 'طريق الملك عبدالله (جسر)', en: 'King Abdullah Rd (overpass)' },
  c1: { ar: 'شارع الريحان', en: 'Al Rayhan St' },
  c2: { ar: 'شارع العُلا', en: 'Al Ula St' },
  c3: { ar: 'شارع الياسمين', en: 'Al Yasmin St' },
};

export const TWIN_ROADS: TwinRoad[] = [
  R('A-0', ROAD_NAMES.arterial.ar, ROAD_NAMES.arterial.en, 'arterial', 3, 70, 'A-S', 'A1'),
  R('A-1', ROAD_NAMES.arterial.ar, ROAD_NAMES.arterial.en, 'arterial', 3, 70, 'A1', 'A2'),
  R('A-2', ROAD_NAMES.arterial.ar, ROAD_NAMES.arterial.en, 'arterial', 3, 70, 'A2', 'A3'),
  R('A-3', ROAD_NAMES.arterial.ar, ROAD_NAMES.arterial.en, 'arterial', 3, 70, 'A3', 'A-N'),
  R('B-0', ROAD_NAMES.secondary.ar, ROAD_NAMES.secondary.en, 'secondary', 2, 50, 'B-S', 'B1'),
  R('B-1', ROAD_NAMES.secondary.ar, ROAD_NAMES.secondary.en, 'secondary', 2, 50, 'B1', 'B2'),
  R('B-2', ROAD_NAMES.secondary.ar, ROAD_NAMES.secondary.en, 'secondary', 2, 50, 'B2', 'B3'),
  R('B-3', ROAD_NAMES.secondary.ar, ROAD_NAMES.secondary.en, 'secondary', 2, 50, 'B3', 'B-N'),
  R('W-1', ROAD_NAMES.local.ar, ROAD_NAMES.local.en, 'local', 1, 40, 'W1', 'W2'),
  R('W-2', ROAD_NAMES.local.ar, ROAD_NAMES.local.en, 'local', 1, 40, 'W2', 'W3'),
  R('C1-W', ROAD_NAMES.c1.ar, ROAD_NAMES.c1.en, 'local', 1, 40, 'W1', 'A1'),
  R('C1-E', ROAD_NAMES.c1.ar, ROAD_NAMES.c1.en, 'local', 1, 40, 'A1', 'B1'),
  R('C2-X', ROAD_NAMES.c2.ar, ROAD_NAMES.c2.en, 'secondary', 2, 50, 'W-W', 'W2'),
  R('C2-W', ROAD_NAMES.c2.ar, ROAD_NAMES.c2.en, 'secondary', 2, 50, 'W2', 'A2'),
  R('C2-E', ROAD_NAMES.c2.ar, ROAD_NAMES.c2.en, 'secondary', 2, 50, 'A2', 'B2'),
  R('C2-Y', ROAD_NAMES.c2.ar, ROAD_NAMES.c2.en, 'secondary', 2, 50, 'B2', 'E2'),
  R('C3-W', ROAD_NAMES.c3.ar, ROAD_NAMES.c3.en, 'local', 1, 40, 'W3', 'A3'),
  R('C3-E', ROAD_NAMES.c3.ar, ROAD_NAMES.c3.en, 'local', 1, 40, 'A3', 'B3'),
  R('K-1', ROAD_NAMES.bridge.ar, ROAD_NAMES.bridge.en, 'bridge', 3, 80, 'K-W', 'K-E', BRIDGE_Y),
];

export const NODE_BY = new Map(TWIN_NODES.map((n) => [n.id, n]));
export const ROAD_BY = new Map(TWIN_ROADS.map((r) => [r.id, r]));

export function roadWidth(r: TwinRoad) {
  return r.lanes * 2 * LANE_W + (r.kind === 'arterial' || r.kind === 'bridge' ? 2 : 0);
}

export function roadLength(r: TwinRoad) {
  const a = NODE_BY.get(r.from)!.p;
  const b = NODE_BY.get(r.to)!.p;
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** The 5 city blocks (axis-aligned plots between streets) — buildings go here. */
export const TWIN_BLOCKS: { id: string; nameAr: string; x0: number; x1: number; z0: number; z1: number }[] = [
  { id: 'BLK-1', nameAr: 'المربع ١', x0: 0, x1: 210, z0: 40, z1: 300 },
  { id: 'BLK-2', nameAr: 'المربع ٢', x0: 0, x1: 210, z0: -220, z1: 40 },
  { id: 'BLK-3', nameAr: 'المربع ٣', x0: -190, x1: 0, z0: 40, z1: 300 },
  { id: 'BLK-4', nameAr: 'المربع ٤', x0: -190, x1: 0, z0: -220, z1: 40 },
  { id: 'BLK-5', nameAr: 'المربع ٥', x0: 0, x1: 210, z0: 300, z1: 440 },
];

export const PROTOTYPE_LABEL_AR = 'نموذج أولي مستوحى من الرياض (حي النخيل) — ليس إعادة بناء جغرافية دقيقة';
export const PROTOTYPE_LABEL_EN = 'Riyadh-Inspired Prototype — not a geographically exact reconstruction';
