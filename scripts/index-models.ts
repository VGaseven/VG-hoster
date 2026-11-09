/**
 * npm run models:index [-- --dir public/models/kitbash --unit auto|1|0.01 --radius 1.8 --max 1500 --name "My kit"]
 * Scans GLB files, computes each model's bounding box and writes manifest.json.
 * KitBash3D kits ship as FBX/OBJ/etc.: export each building to GLB (e.g. Blender → glTF 2.0 binary).
 */
import fs from 'node:fs';
import path from 'node:path';
import { glbBounds, readGlbJson } from './glb';
import { KitManifestSchema } from '../src/data/kitbash';

const args = process.argv.slice(2);
const get = (k: string, d?: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const dir = path.resolve(get('dir', 'public/models/kitbash')!);
if (!fs.existsSync(dir)) {
  console.error(`[models] folder not found: ${dir}`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb')).sort();
if (!files.length) {
  console.error(`[models] no .glb files in ${dir}`);
  process.exit(1);
}
const models = files.map((file) => {
  const { min, max } = glbBounds(readGlbJson(fs.readFileSync(path.join(dir, file))));
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((x) => +x.toFixed(3)) as [number, number, number];
  const ratio = size[1] / Math.max(size[0], size[2]);
  return { file, size, weight: 1, role: ratio > 2.5 ? 'tower' : ratio > 0.9 ? 'mid' : 'low' } as const;
});
const unitArg = get('unit', 'auto')!;
const largest = Math.max(...models.map((m) => m.size[1]));
const unitScale = unitArg === 'auto' ? (largest > 2000 ? 0.01 : 1) : Number(unitArg);
const manifest = KitManifestSchema.parse({
  name: get('name', path.basename(dir)),
  licenseNote: 'Licensed assets — do not redistribute. This folder is gitignored.',
  unitScale,
  radiusKm: Number(get('radius', '3')),
  maxInstances: Number(get('max', '1500')),
  models,
});
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`[models] ${models.length} model(s), unitScale ${unitScale} → ${path.join(dir, 'manifest.json')}`);
for (const m of models) console.log(`  ${m.file}: ${m.size.join(' × ')} (${m.role})`);
