/**
 * Replace the schematic straight-block geometry with exact OpenStreetMap way geometry.
 * Requires network access to an Overpass API instance (blocked in the original build
 * environment, so this script is provided but was NOT validated there).
 *
 *   npm run data:fetch-osm [-- --endpoint https://overpass-api.de/api/interpreter]
 *
 * For each road block it downloads ways with the matching English/Arabic name inside the
 * study bounding box, keeps OSM nodes whose projection falls between the block's end
 * intersections (local u/v frame), orders them along the block and writes
 * src/data/osm-geometry.json  { "<segmentId>": [[lng,lat], ...] }.
 * Data © OpenStreetMap contributors, ODbL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SEGMENTS, NODE_BY_ID, NETWORK_BOUNDS, lngLatToUv, ROAD_NAMES } from '../src/data/network';
import type { LngLat } from '../src/types';

const args = process.argv.slice(2);
const endpoint = args[args.indexOf('--endpoint') + 1] && args.includes('--endpoint') ? args[args.indexOf('--endpoint') + 1] : 'https://overpass-api.de/api/interpreter';
const [[w, s], [e, n]] = NETWORK_BOUNDS;
const bbox = `${s - 0.01},${w - 0.01},${n + 0.01},${e + 0.01}`;

const ROAD_PATTERNS: Record<string, string> = {
  KFR: 'King Fahd|الملك فهد',
  OLY: 'Olaya|العليا',
  TAK: 'Takhassusi|التخصصي',
  MAK: 'Makkah|مكة',
  THL: 'Tahlia|Prince Mohammed bin Abdulaziz|التحلية|الأمير محمد بن عبدالعزيز',
  URB: 'Urubah|Orouba|العروبة',
  KAR: 'King Abdullah|الملك عبدالله',
};

async function main() {
  const out: Record<string, LngLat[]> = {};
  for (const [roadId, pattern] of Object.entries(ROAD_PATTERNS)) {
    const q = `[out:json][timeout:60];way["highway"]["name"~"${pattern}",i](${bbox});(._;>;);out body;`;
    console.log(`[osm] ${ROAD_NAMES[roadId].en} …`);
    const res = await fetch(endpoint, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const json = (await res.json()) as { elements: { type: string; id: number; lat?: number; lon?: number }[] };
    const pts = json.elements.filter((x) => x.type === 'node').map((x) => [x.lon!, x.lat!] as LngLat);
    for (const seg of SEGMENTS.filter((x) => x.roadId === roadId)) {
      const a = lngLatToUv(NODE_BY_ID.get(seg.from)!.coord);
      const b = lngLatToUv(NODE_BY_ID.get(seg.to)!.coord);
      const alongU = Math.abs(b.u - a.u) > Math.abs(b.v - a.v);
      const lo = Math.min(alongU ? a.u : a.v, alongU ? b.u : b.v);
      const hi = Math.max(alongU ? a.u : a.v, alongU ? b.u : b.v);
      const across = alongU ? a.v : a.u;
      const sel = pts
        .map((p) => ({ p, uv: lngLatToUv(p) }))
        .filter(({ uv }) => {
          const t = alongU ? uv.u : uv.v;
          const c = alongU ? uv.v : uv.u;
          return t > lo && t < hi && Math.abs(c - across) < 0.45;
        })
        .sort((x, y) => (alongU ? x.uv.u - y.uv.u : x.uv.v - y.uv.v));
      if (sel.length < 2) continue;
      const ordered = sel.map((x) => x.p);
      const startFirst = (alongU ? a.u : a.v) <= (alongU ? b.u : b.v);
      out[seg.id] = [NODE_BY_ID.get(seg.from)!.coord, ...(startFirst ? ordered : ordered.reverse()), NODE_BY_ID.get(seg.to)!.coord];
    }
  }
  const file = path.join(process.cwd(), 'src/data/osm-geometry.json');
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`[osm] wrote ${Object.keys(out).length} segment geometries → ${file}`);
}

main().catch((e) => {
  console.error('[osm] failed:', e.message);
  process.exit(1);
});
