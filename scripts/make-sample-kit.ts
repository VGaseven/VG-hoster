/**
 * npm run models:sample — writes a tiny SELF-MADE placeholder kit (CC0, not KitBash) into
 * public/models/kitbash so the optional loader can be tried and tested without licensed files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeBoxesGlb } from './glb';

const dir = path.resolve(process.argv[2] ?? 'public/models/kitbash');
fs.mkdirSync(dir, { recursive: true });
const glass: [number, number, number] = [0.42, 0.55, 0.95];
const dark: [number, number, number] = [0.16, 0.2, 0.42];
const violet: [number, number, number] = [0.55, 0.45, 0.95];
const kits: Record<string, [number, number, number, number, [number, number, number]][]> = {
  'sample-tower.glb': [[30, 90, 30, 0, dark], [24, 60, 24, 90, glass], [10, 30, 10, 150, violet]],
  'sample-midrise.glb': [[40, 30, 34, 0, dark], [34, 6, 28, 30, glass]],
  'sample-lowrise.glb': [[44, 9, 36, 0, dark], [20, 4, 16, 9, violet]],
};
for (const [f, boxes] of Object.entries(kits)) fs.writeFileSync(path.join(dir, f), writeBoxesGlb(boxes));
console.log(`[models] wrote ${Object.keys(kits).length} sample GLBs to ${dir} — now run: npm run models:index`);
