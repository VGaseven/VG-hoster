import { describe, expect, it } from 'vitest';
import { writeBoxesGlb, readGlbJson, glbBounds } from '../../scripts/glb';
import { assignKitModels, KitManifestSchema, replacedBuildingIds } from '@/data/kitbash';
import { generateBuildings } from '@/data/buildings';
import { DISTRICT_CENTER, lngLatToKm, ORIGIN } from '@/data/network';

describe('optional building kit pipeline', () => {
  it('reads GLB bounds through the node hierarchy (index script core)', () => {
    const glb = writeBoxesGlb([
      [30, 90, 30, 0, [0, 0, 1]],
      [10, 30, 10, 90, [1, 0, 0]],
    ]);
    const { min, max } = glbBounds(readGlbJson(glb));
    expect(max[1] - min[1]).toBeCloseTo(120, 5);
    expect(max[0] - min[0]).toBeCloseTo(30, 5);
    expect(() => readGlbJson(Buffer.from('not a glb at all'))).toThrow();
  });

  it('validates manifests (rejects non-GLB names and empty kits)', () => {
    expect(KitManifestSchema.safeParse({ models: [] }).success).toBe(false);
    expect(KitManifestSchema.safeParse({ models: [{ file: '../evil.js', size: [1, 1, 1] }] }).success).toBe(false);
    expect(KitManifestSchema.parse({ models: [{ file: 'a.glb', size: [10, 20, 10] }] }).radiusKm).toBe(3);
  });

  it('places models deterministically inside the single district, fitted to footprints', () => {
    const m = KitManifestSchema.parse({
      models: [
        { file: 'tower.glb', size: [30, 180, 30] },
        { file: 'mid.glb', size: [40, 36, 34] },
        { file: 'low.glb', size: [44, 13, 36] },
      ],
    });
    const a = assignKitModels(m);
    expect(a).toEqual(assignKitModels(m));
    expect(a.length).toBeGreaterThan(100);
    const c = lngLatToKm(DISTRICT_CENTER);
    const o = lngLatToKm(ORIGIN);
    for (const p of a) {
      const d = Math.hypot(p.east / 1000 + o.x - c.x, p.north / 1000 + o.y - c.y);
      expect(d).toBeLessThanOrEqual(m.radiusKm + 1e-9);
      expect(p.scale).toBeGreaterThan(0);
    }
    // low synthetic blocks get low models; towers are the minority
    const towers = a.filter((p) => p.file === 'tower.glb').length;
    expect(towers / a.length).toBeLessThan(0.2);
    const hidden = replacedBuildingIds(a);
    expect(hidden.size).toBeGreaterThanOrEqual(a.length);
    expect(generateBuildings().filter((b) => hidden.has(b.id)).length).toBe(hidden.size);
  });
});
