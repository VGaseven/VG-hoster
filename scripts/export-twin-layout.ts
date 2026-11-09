/** npm run twin:layout — writes the 5-block layout (single source of truth) for Blender. */
import fs from 'node:fs';
import { TWIN_NODES, TWIN_ROADS, TWIN_BLOCKS, roadWidth, LANE_W, SIDEWALK_W, BRIDGE_Y, PROTOTYPE_LABEL_EN } from '../src/twin/layout';
fs.mkdirSync('public/twin', { recursive: true });
fs.writeFileSync(
  'public/twin/layout.json',
  JSON.stringify(
    {
      note: `${PROTOTYPE_LABEL_EN}. Units: metres; x = east, z = south (Three.js). Blender uses x = east, y = north (−z), z = up.`,
      laneWidth: LANE_W,
      sidewalkWidth: SIDEWALK_W,
      bridgeY: BRIDGE_Y,
      nodes: TWIN_NODES,
      roads: TWIN_ROADS.map((r) => ({ ...r, width: roadWidth(r) })),
      blocks: TWIN_BLOCKS,
    },
    null,
    2,
  ),
);
console.log('[twin] wrote public/twin/layout.json');
