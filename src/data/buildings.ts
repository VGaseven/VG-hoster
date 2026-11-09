/**
 * Building massing.
 * - Online: real OpenStreetMap building footprints/heights come from the vector basemap.
 * - Offline / video: SYNTHETIC procedural massing generated inside the street blocks with a
 *   fixed seed (clearly labeled), plus approximate landmark towers.
 */
import type { LngLat } from '@/types';
import { uvToLngLat, lngLatToUv } from './network';
import { mulberry32 } from '@/utils/random';

export interface Building {
  id: string;
  /** polygon ring (lng/lat), closed */
  ring: LngLat[];
  /** local uv corners (km) for the video renderer */
  uv: { u: number; v: number }[];
  height: number; // m
  base: number; // m
  landmark?: string;
}

const V_LINES = [-2.5, -1.5, -0.12, 0.3, 1.6];
const U_LINES = [-4.2, -3.2, -1.5, 0.15, 3.3, 4.3];

function box(id: string, u: number, v: number, du: number, dv: number, height: number, base = 0, landmark?: string): Building {
  const uv = [
    { u: u - du / 2, v: v - dv / 2 },
    { u: u - du / 2, v: v + dv / 2 },
    { u: u + du / 2, v: v + dv / 2 },
    { u: u + du / 2, v: v - dv / 2 },
  ];
  const ring = uv.map((p) => uvToLngLat(p.u, p.v));
  ring.push(ring[0]);
  return { id, ring, uv, height, base, landmark };
}

export function generateBuildings(spacingKm = 0.075, seed = 7): Building[] {
  const rnd = mulberry32(seed);
  const out: Building[] = [];
  const setback = 0.07;
  for (let i = 0; i < V_LINES.length - 1; i++)
    for (let j = 0; j < U_LINES.length - 1; j++) {
      const v0 = V_LINES[i] + setback;
      const v1 = V_LINES[i + 1] - setback;
      const u0 = U_LINES[j] + setback;
      const u1 = U_LINES[j + 1] - setback;
      for (let u = u0 + spacingKm / 2; u < u1; u += spacingKm)
        for (let v = v0 + spacingKm / 2; v < v1; v += spacingKm) {
          if (rnd() < 0.22) continue; // courtyards, parking, plots
          // proximity to King Fahd Rd / Olaya core → taller towers
          const core = Math.exp(-((v - 0.09) ** 2) / 0.18) * Math.exp(-((u + 0.8) ** 2) / 9);
          const nearRoad = Math.min(...V_LINES.map((x) => Math.abs(x - v)), ...U_LINES.map((x) => Math.abs(x - u))) < 0.16;
          let h = 6 + rnd() * 10;
          if (nearRoad) h += rnd() * 18;
          if (core > 0.25 && nearRoad && rnd() < 0.5) h += 25 + rnd() * 110 * core;
          const fp = spacingKm * (0.55 + rnd() * 0.3);
          out.push(box(`b${out.length}`, u + (rnd() - 0.5) * 0.01, v + (rnd() - 0.5) * 0.01, fp, fp * (0.7 + rnd() * 0.5), Math.round(h)));
        }
    }
  // Approximate landmark towers (positions approximate; shapes simplified)
  const k = lngLatToUv([46.6744, 24.7114]);
  out.push(box('kingdom', k.u, k.v + 0.05, 0.07, 0.07, 302, 0, 'برج المملكة'));
  const f = lngLatToUv([46.6853, 24.6903]);
  out.push(box('faisaliah-1', f.u, f.v + 0.03, 0.06, 0.06, 180, 0, 'برج الفيصلية'));
  out.push(box('faisaliah-2', f.u, f.v + 0.03, 0.035, 0.035, 240, 180));
  out.push(box('faisaliah-3', f.u, f.v + 0.03, 0.015, 0.015, 267, 240));
  return out;
}

export function buildingsGeoJSON(b: Building[]) {
  return {
    type: 'FeatureCollection' as const,
    features: b.map((x) => ({
      type: 'Feature' as const,
      properties: { id: x.id, height: x.height, base: x.base, landmark: x.landmark ?? '' },
      geometry: { type: 'Polygon' as const, coordinates: [x.ring] },
    })),
  };
}
