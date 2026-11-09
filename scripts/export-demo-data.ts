/** npm run data:export — writes the reproducible sample dataset to public/demo-data/. */
import fs from 'node:fs';
import { createSeedProjects, createDemoConflictProject, SCENARIOS, PLACES, CITIZEN_JOURNEYS } from '../src/data/projects';
import { NODES, SEGMENTS, DISTRICT_OUTLINE } from '../src/data/network';
import { ORGANIZATIONS } from '../src/data/organizations';
import { closureLine } from '../src/engine/spatial/geometry';
import { DATA_SEED } from '../src/utils/random';

const ps = createSeedProjects();
const note = 'HYPOTHETICAL demonstration data for RASD (Naqlthon 5). Scope: one district — حي العليا, Riyadh. Not real government roadworks. Road names real; geometry schematic/approximate.';
fs.mkdirSync('public/demo-data', { recursive: true });
fs.writeFileSync('public/demo-data/projects.json', JSON.stringify({ note, seed: DATA_SEED, organizations: ORGANIZATIONS, scenarios: SCENARIOS, demoConflictProject: createDemoConflictProject(), projects: ps }, null, 2));
fs.writeFileSync(
  'public/demo-data/network.geojson',
  JSON.stringify(
    {
      type: 'FeatureCollection',
      note,
      features: [
        { type: 'Feature', properties: { kind: 'district-outline', name: 'حي العليا (تقريبي)' }, geometry: { type: 'LineString', coordinates: DISTRICT_OUTLINE } },
        ...SEGMENTS.map((s) => ({ type: 'Feature', properties: { id: s.id, name: s.name, nameEn: s.nameEn, class: s.roadClass, lanesPerDirection: s.lanesPerDirection, freeSpeedKmh: s.freeSpeedKmh, closable: s.closable }, geometry: { type: 'LineString', coordinates: s.coords } })),
        ...NODES.map((n) => ({ type: 'Feature', properties: { id: n.id, kind: n.kind, name: n.name, nameEn: n.nameEn }, geometry: { type: 'Point', coordinates: n.coord } })),
      ],
    },
    null,
    1,
  ),
);
fs.writeFileSync('public/demo-data/closures.geojson', JSON.stringify({ type: 'FeatureCollection', note, features: ps.flatMap((p) => p.closures.map((c) => ({ ...closureLine(c), properties: { projectId: p.id, title: p.title, org: p.orgId, start: p.schedule.start, end: p.schedule.end } }))) }, null, 1));
fs.writeFileSync('public/demo-data/citizen-journeys.json', JSON.stringify({ note, places: PLACES, journeys: CITIZEN_JOURNEYS }, null, 2));
console.log('[data] wrote public/demo-data/*');
