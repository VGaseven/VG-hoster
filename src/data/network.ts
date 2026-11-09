/**
 * RASD demonstration road network — Olaya / King Fahd Road corridor, Riyadh.
 *
 * Road NAMES are real Riyadh roads. Geometry is a SIMPLIFIED, hand-traced schematic of
 * their alignment (straight blocks between major intersections), calibrated against
 * OpenStreetMap neighbourhood centroids (© OpenStreetMap contributors, ODbL) and well-known
 * landmarks (Kingdom Centre, Al Faisaliah Tower). Positions are approximate (±200–400 m).
 * The build environment could not reach OpenStreetMap/Overpass; run `npm run data:fetch-osm`
 * on a networked machine to replace the straight blocks with exact OSM way geometry.
 *
 * The local frame is aligned with the King Fahd Road axis (≈25° west of north), which is
 * how the Olaya street grid is actually oriented.
 */
import type { LngLat, NetworkNode, RoadClass, RoadSegment } from '@/types';
import osmOverride from './osm-geometry.json';

export const ORIGIN: LngLat = [46.6744, 24.7114]; // Kingdom Centre (approx.)
const KM_PER_DEG_LAT = 110.9;
const KM_PER_DEG_LNG = 111.32 * Math.cos((ORIGIN[1] * Math.PI) / 180);
const U: [number, number] = [-0.426, 0.905]; // along King Fahd Rd (north-north-west)
const V: [number, number] = [0.905, 0.426]; // across (east-north-east)

export function uvToLngLat(u: number, v: number): LngLat {
  const x = u * U[0] + v * V[0];
  const y = u * U[1] + v * V[1];
  return [round6(ORIGIN[0] + x / KM_PER_DEG_LNG), round6(ORIGIN[1] + y / KM_PER_DEG_LAT)];
}

export function lngLatToUv([lng, lat]: LngLat): { u: number; v: number } {
  const x = (lng - ORIGIN[0]) * KM_PER_DEG_LNG;
  const y = (lat - ORIGIN[1]) * KM_PER_DEG_LAT;
  return { u: x * U[0] + y * U[1], v: x * V[0] + y * V[1] };
}

/** Local planar km (east, north) — used by the deterministic video renderer. */
export function lngLatToKm([lng, lat]: LngLat): { x: number; y: number } {
  return { x: (lng - ORIGIN[0]) * KM_PER_DEG_LNG, y: (lat - ORIGIN[1]) * KM_PER_DEG_LAT };
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

interface RoadDef {
  id: string;
  name: string;
  nameEn: string;
  cls: RoadClass;
  lanes: number;
  speed: number;
}

/** North–south roads (constant v). */
const NS_ROADS: (RoadDef & { v: number })[] = [
  { id: 'TAK', name: 'شارع التخصصي', nameEn: 'Al Takhassusi St', cls: 'secondary', lanes: 3, speed: 60, v: -1.5 },
  { id: 'KFR', name: 'طريق الملك فهد', nameEn: 'King Fahd Rd', cls: 'motorway', lanes: 5, speed: 75, v: -0.12 },
  { id: 'OLY', name: 'شارع العليا', nameEn: 'Olaya St', cls: 'primary', lanes: 3, speed: 60, v: 0.3 },
];

/** East–west roads (constant u). */
const EW_ROADS: (RoadDef & { u: number })[] = [
  { id: 'MAK', name: 'طريق مكة المكرمة', nameEn: 'Makkah Al Mukarramah Rd', cls: 'motorway', lanes: 4, speed: 70, u: -3.2 },
  { id: 'THL', name: 'طريق الأمير محمد بن عبدالعزيز (التحلية)', nameEn: 'Prince Mohammed bin Abdulaziz Rd (Tahlia)', cls: 'primary', lanes: 3, speed: 50, u: -1.5 },
  { id: 'URB', name: 'طريق العروبة', nameEn: 'Al Urubah Rd', cls: 'primary', lanes: 3, speed: 60, u: 0.15 },
  { id: 'KAR', name: 'طريق الملك عبدالله', nameEn: 'King Abdullah Rd', cls: 'motorway', lanes: 4, speed: 80, u: 3.3 },
];

const U_SOUTH = -4.2;
const U_NORTH = 4.3;
const V_WEST = -2.5;
const V_EAST = 1.6;

const DIR_AR: Record<string, string> = { S: 'جنوباً', N: 'شمالاً', W: 'غرباً', E: 'شرقاً' };
const DIR_EN: Record<string, string> = { S: 'southbound exit', N: 'northbound exit', W: 'westbound exit', E: 'eastbound exit' };

function buildNetwork() {
  const nodes: NetworkNode[] = [];
  const segments: RoadSegment[] = [];
  const add = (n: Omit<NetworkNode, 'coord'>) => {
    const node: NetworkNode = { ...n, coord: uvToLngLat(n.u, n.v) };
    nodes.push(node);
    return node;
  };

  for (const ns of NS_ROADS)
    for (const ew of EW_ROADS)
      add({
        id: `I-${ns.id}-${ew.id}`,
        kind: 'intersection',
        name: `تقاطع ${ns.name} مع ${ew.name}`,
        nameEn: `${ns.nameEn} × ${ew.nameEn}`,
        u: ew.u,
        v: ns.v,
      });
  for (const ns of NS_ROADS) {
    add({ id: `G-${ns.id}-S`, kind: 'gate', name: `${ns.name} (${DIR_AR.S})`, nameEn: `${ns.nameEn} (${DIR_EN.S})`, u: U_SOUTH, v: ns.v });
    add({ id: `G-${ns.id}-N`, kind: 'gate', name: `${ns.name} (${DIR_AR.N})`, nameEn: `${ns.nameEn} (${DIR_EN.N})`, u: U_NORTH, v: ns.v });
  }
  for (const ew of EW_ROADS) {
    add({ id: `G-${ew.id}-W`, kind: 'gate', name: `${ew.name} (${DIR_AR.W})`, nameEn: `${ew.nameEn} (${DIR_EN.W})`, u: ew.u, v: V_WEST });
    add({ id: `G-${ew.id}-E`, kind: 'gate', name: `${ew.name} (${DIR_AR.E})`, nameEn: `${ew.nameEn} (${DIR_EN.E})`, u: ew.u, v: V_EAST });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const override = osmOverride as Record<string, LngLat[]>;
  const seg = (road: RoadDef, a: string, b: string, aKey: string, bKey: string) => {
    const na = byId.get(a)!;
    const nb = byId.get(b)!;
    const id = `${road.id}-${aKey}-${bKey}`;
    const coords = override[id] && override[id].length >= 2 ? override[id] : [na.coord, nb.coord];
    segments.push({
      id,
      roadId: road.id,
      name: road.name,
      nameEn: road.nameEn,
      from: a,
      to: b,
      roadClass: road.cls,
      lanesPerDirection: road.lanes,
      freeSpeedKmh: road.speed,
      coords,
      lengthKm: polylineKm(coords),
      closable: true,
    });
  };

  for (const ns of NS_ROADS) {
    const chain = [`G-${ns.id}-S`, ...EW_ROADS.map((e) => `I-${ns.id}-${e.id}`), `G-${ns.id}-N`];
    const keys = ['S', ...EW_ROADS.map((e) => e.id), 'N'];
    for (let i = 0; i < chain.length - 1; i++) seg(ns, chain[i], chain[i + 1], keys[i], keys[i + 1]);
  }
  for (const ew of EW_ROADS) {
    const chain = [`G-${ew.id}-W`, ...NS_ROADS.map((n) => `I-${n.id}-${ew.id}`), `G-${ew.id}-E`];
    const keys = ['W', ...NS_ROADS.map((n) => n.id), 'E'];
    for (let i = 0; i < chain.length - 1; i++) seg(ew, chain[i], chain[i + 1], keys[i], keys[i + 1]);
  }

  // Zones (neighbourhood / landmark centroids). Centroids from OpenStreetMap place nodes
  // (neighbourhoods) and approximate landmark positions; connectors are local access streets.
  const zones: { id: string; name: string; nameEn: string; coord: LngLat; access: string[] }[] = [
    { id: 'Z-OLAYA', name: 'حي العليا', nameEn: 'Al Olaya District', coord: [46.6834, 24.6924], access: ['I-KFR-MAK', 'I-OLY-MAK', 'I-KFR-THL', 'I-OLY-THL'] },
    { id: 'Z-WURUD', name: 'حي الورود', nameEn: 'Al Wurud District', coord: [46.6785, 24.7244], access: ['I-OLY-URB', 'I-OLY-KAR'] },
    { id: 'Z-RAHMANIYAH', name: 'حي الرحمانية', nameEn: 'Ar Rahmaniyah District', coord: [46.6594, 24.7161], access: ['I-TAK-URB', 'I-KFR-URB', 'I-TAK-KAR', 'I-KFR-KAR'] },
    { id: 'Z-SULAYMANIYAH', name: 'حي السليمانية', nameEn: 'As Sulaymaniyah District', coord: [46.7025, 24.6986], access: ['I-OLY-MAK', 'I-OLY-THL'] },
    { id: 'Z-KINGDOM', name: 'برج المملكة', nameEn: 'Kingdom Centre', coord: [46.6744, 24.7114], access: ['I-KFR-URB', 'I-OLY-URB', 'I-KFR-THL', 'I-OLY-THL'] },
    { id: 'Z-FAISALIAH', name: 'برج الفيصلية', nameEn: 'Al Faisaliah Tower', coord: [46.6853, 24.6903], access: ['I-KFR-MAK', 'I-KFR-THL', 'I-OLY-MAK'] },
  ];
  for (const z of zones) {
    const { u, v } = lngLatToUv(z.coord);
    nodes.push({ id: z.id, kind: 'zone', name: z.name, nameEn: z.nameEn, coord: z.coord, u, v });
    for (const a of z.access) {
      const na = byId.get(a)!;
      const coords: LngLat[] = [z.coord, na.coord];
      segments.push({
        id: `CON-${z.id.slice(2)}-${a.slice(2)}`,
        roadId: 'LOCAL',
        name: 'شارع محلي (وصلة وصول)',
        nameEn: 'Local access street',
        from: z.id,
        to: a,
        roadClass: 'connector',
        lanesPerDirection: 1,
        freeSpeedKmh: 30,
        coords,
        lengthKm: polylineKm(coords),
        closable: false,
      });
    }
  }
  return { nodes, segments };
}

export function polylineKm(coords: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i]);
  return km;
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371.0088;
  const toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR;
  const dLng = (b[0] - a[0]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const built = buildNetwork();
export const NODES: NetworkNode[] = built.nodes;
export const SEGMENTS: RoadSegment[] = built.segments;
export const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));
export const SEGMENT_BY_ID = new Map(SEGMENTS.map((s) => [s.id, s]));
export const CLOSABLE_SEGMENTS = SEGMENTS.filter((s) => s.closable);
export const GATES = NODES.filter((n) => n.kind === 'gate');
export const ZONES = NODES.filter((n) => n.kind === 'zone');
export const ROAD_NAMES: Record<string, { ar: string; en: string }> = Object.fromEntries(
  [...NS_ROADS, ...EW_ROADS].map((r) => [r.id, { ar: r.name, en: r.nameEn }]),
);

export const NETWORK_BOUNDS: [LngLat, LngLat] = (() => {
  const xs = NODES.map((n) => n.coord[0]);
  const ys = NODES.map((n) => n.coord[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
})();

export const RIYADH_OVERVIEW = { center: [46.6853, 24.7136] as LngLat, zoom: 10.6 };
export const STUDY_AREA_VIEW = { center: [46.6744, 24.7114] as LngLat, zoom: 13.2, pitch: 55, bearing: -25 };

export const GEOMETRY_NOTE_AR =
  'أسماء الطرق حقيقية، والمسارات مخطط مبسّط تقريبي (±٢٠٠–٤٠٠ م) لعدم توفر اتصال بـ OpenStreetMap أثناء البناء.';
