/**
 * OPTIONAL licensed building models (e.g. KitBash3D kits exported to GLB).
 *
 * Licensed assets are NEVER committed: drop GLB files in `public/models/kitbash/` (gitignored),
 * run `npm run models:index` to write `manifest.json`, and the offline digital twin + the video
 * replace the synthetic blocks around the study area with these models. Without a manifest the
 * app behaves exactly as before.
 *
 * Placement is a pure, deterministic function (seeded) so the live map and the frame-by-frame
 * video show the same models at the same footprints.
 */
import { z } from 'zod';
import { generateBuildings, type Building } from './buildings';
import { DISTRICT_CENTER, lngLatToKm, ORIGIN, uvToLngLat } from './network';
import { mulberry32 } from '@/utils/random';

export const KIT_BASE_PATH = 'models/kitbash';

export const KitModelSchema = z.object({
  file: z.string().regex(/^[\w.\- ]+\.glb$/i, 'GLB file name'),
  /** natural bounding box in metres: [width (x), height (y-up), depth (z)] */
  size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  /** relative selection weight */
  weight: z.number().positive().default(1),
  /** optional manual role; otherwise inferred from proportions */
  role: z.enum(['tower', 'mid', 'low', 'landmark']).optional(),
});
export type KitModel = z.infer<typeof KitModelSchema>;

export const KitManifestSchema = z.object({
  name: z.string().default('Licensed building kit'),
  licenseNote: z.string().default(''),
  /** metres in model units (KitBash GLB exports are usually centimetres → 0.01) */
  unitScale: z.number().positive().default(1),
  /** replace synthetic buildings within this radius (km) of the study centre */
  radiusKm: z.number().positive().max(6).default(3),
  maxInstances: z.number().int().positive().max(5000).default(1500),
  models: z.array(KitModelSchema).min(1),
});
export type KitManifest = z.infer<typeof KitManifestSchema>;

export interface KitPlacement {
  buildingId: string;
  file: string;
  /** metres relative to ORIGIN */
  east: number;
  north: number;
  /** rotation about the vertical axis (radians, counter-clockwise from east) */
  rotation: number;
  /** uniform scale applied to the model (after unitScale) */
  scale: number;
  /** resulting height (m) */
  height: number;
}

/** Street-grid orientation (v axis, ENE) — models are aligned to the Olaya block grid. */
export const GRID_ROTATION = Math.atan2(0.426, 0.905);

function footprintMetres(b: Building) {
  const [a, c, d] = [b.uv[0], b.uv[1], b.uv[3]];
  const alongV = Math.hypot(c.u - a.u, c.v - a.v) * 1000;
  const alongU = Math.hypot(d.u - a.u, d.v - a.v) * 1000;
  return { w: alongV, d: alongU };
}

export function assignKitModels(manifest: KitManifest, buildings: Building[] = generateBuildings(), seed = 17): KitPlacement[] {
  const rnd = mulberry32(seed);
  const unit = manifest.unitScale;
  const models = manifest.models.map((m) => ({ ...m, w: m.size[0] * unit, h: m.size[1] * unit, d: m.size[2] * unit }));
  const origin = lngLatToKm(ORIGIN);
  const centre = lngLatToKm(DISTRICT_CENTER);
  const cands = buildings
    .map((b) => {
      const cu = b.uv.reduce((s, p) => s + p.u, 0) / 4;
      const cv = b.uv.reduce((s, p) => s + p.v, 0) / 4;
      const km = lngLatToKm(uvToLngLat(cu, cv));
      const dist = Math.hypot(km.x - centre.x, km.y - centre.y);
      return { b, km, dist };
    })
    .filter((x) => x.dist <= manifest.radiusKm && !x.b.base)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, manifest.maxInstances);
  const out: KitPlacement[] = [];
  for (const { b, km } of cands) {
    const fp = footprintMetres(b);
    const target = b.height;
    // score each model: footprint-fit uniform scale → height error; landmarks prefer towers
    const scored = models
      .map((m) => {
        const s = Math.min(fp.w / m.w, fp.d / m.d);
        const h = m.h * s;
        let err = Math.abs(Math.log(Math.max(h, 1) / Math.max(target, 1)));
        if (b.landmark && m.role && m.role !== 'landmark' && m.role !== 'tower') err += 2;
        return { m, s, h, err: err / Math.sqrt(m.weight) };
      })
      .sort((a, b) => a.err - b.err);
    // vary only among near-equally good fits (log-height error within 0.2 of the best)
    const good = scored.filter((x) => x.err <= scored[0].err + 0.2);
    const pick = good[Math.floor(rnd() * good.length)];
    if (!pick || pick.s <= 0 || !Number.isFinite(pick.s)) continue;
    out.push({
      buildingId: b.id,
      file: pick.m.file,
      east: (km.x - origin.x) * 1000,
      north: (km.y - origin.y) * 1000,
      rotation: GRID_ROTATION + (rnd() < 0.5 ? 0 : Math.PI),
      scale: pick.s * unit,
      height: pick.h,
    });
  }
  // landmark parts with a base (stacked towers) are removed with their footprint
  return out;
}

export function replacedBuildingIds(placements: KitPlacement[], buildings: Building[] = generateBuildings()) {
  const ids = new Set(placements.map((p) => p.buildingId));
  // also hide the stacked upper parts of a replaced landmark (same footprint centre)
  if (ids.has('faisaliah-1')) for (const b of buildings) if (b.id.startsWith('faisaliah')) ids.add(b.id);
  return ids;
}

export async function loadKitManifest(baseUrl: string): Promise<KitManifest | null> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/manifest.json`, { cache: 'no-cache' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null; // SPA fallback returned index.html
    const parsed = KitManifestSchema.safeParse(await r.json());
    if (!parsed.success) {
      console.warn('[RASD] invalid kit manifest', parsed.error.issues);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
