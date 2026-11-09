# رَصد | RASD — Naqlthon 5 prototype

**المسار: التنقل الذكي المدعوم بالبيانات · تنسيقٌ مبكر يحمي حركة المدينة**

> خدمة تجمع خطط الإغلاقات، تكشف تعارضها وتقارن بدائلها، وتُظهر الإغلاقات مسبقاً لمستخدمي الطريق.

RASD is a proactive **road-closure coordination and decision-support** prototype (not a traffic
surveillance, emergency or environmental platform). It follows the official mechanism from the
team's Naqlthon 5 presentation:

> **إدخال المشاريع ← تحليل التعارض ← مقارنة البدائل ← مراجعة القرار**
> Project data → Conflict analysis → Alternative comparison → Decision review

* **Scope: one district only — حي العليا (Al Olaya), Riyadh.** The simulated network is the
  district's own main roads (King Fahd Rd and Olaya St, crossed by Makkah Rd, Tahlia and Al Urubah
  Rd) plus short boundary entries; buildings, camera, tour, citizen places and the video stay inside
  the district (approximate outline shown on the map). All projects are clearly *hypothetical*.
* **Three official alternatives**: تقديم الموعد حسب المرونة · تأخير الموعد حسب الأولوية ·
  نافذة مشتركة إذا أمكن فنيًا. Earlier/delay search the flexibility window for the closest slot
  that introduces no new conflicts; a shared window is **never auto-recommended** and requires
  explicit technical confirmation by both entities.
* **Decision review**: the responsible authority can **accept, reject (with reason) or modify**
  (dates constrained to each project's window); every decision is logged with its rationale.
* **Primary outcomes** (computed, never assumed): إغلاقات أقل تكراراً (closure episodes / repeated
  closures) · أثر أخف على الحركة (closure km-days, conflicts) · استعداد أفضل لمستخدم الطريق
  (share of closures published before the day of travel). Traffic delay, detour and economic cost
  are *supplementary modelled indicators* with transparent assumptions.
* **Stakeholders**: citizens & residents (“خطّط لرحلة الغد قبل مفاجأة الإغلاق”), responsible
  authorities, executing entities (contractors/utilities), transport operators.
* **«عرض سيناريو رصد»**: a 10-scene automated but controllable demonstration (play / pause /
  replay / back / next / reset) of the full story.

> ⚠️ **All project records are hypothetical.** Traffic values come from a local simulation model
> (synthetic demand), not real telemetry. Economic figures use configurable, illustrative
> assumptions — not official statistics. No integration with Google Maps or any government
> platform is implied. The UI shows a permanent **SIMULATION DATA** badge.

---

## Quick start

```bash
npm install
npm run dev            # web app (http://localhost:5173) + local render worker (:3210)
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server **and** the local Remotion render worker (used by Video Studio “تصدير الفيديو”) |
| `npm run dev:web` | Web app only |
| `npm run build` | Strict TypeScript check (`tsc -b`) + production build to `dist/` |
| `npm run preview` | Serve the production build (proxies `/api` to the render worker) |
| `npm run test` | Vitest unit + integration tests (engine, optimizer, workflow, export) |
| `npm run test:e2e` | Playwright end-to-end acceptance tests (starts its own Vite server, offline basemap) |
| `npm run video:preview` | Remotion Studio for the video composition |
| `npm run export-sim` | Render the cinematic MP4 → `output/rasd-simulation.mp4` |
| `npm run render-server` | Local render worker only |
| `npm run data:export` | Re-write the sample dataset in `public/demo-data/` |
| `npm run models:sample` / `npm run models:index` | Optional building kit: write a self-made sample kit / index your own GLB files (see below) |
| `npm run data:fetch-osm` | (needs Overpass access) replace schematic road geometry with exact OSM geometry |

`export-sim` options: `-- --preset 1080p|4k|vertical|square --duration 45..60 --camera cinematic|orbit|topdown --no-captions --no-metrics --out <file>`.

Requirements: Node 20+ (tested on Node 22), Chromium/Chrome for rendering (auto-detected from
`/opt/pw-browsers`, or set `REMOTION_BROWSER`; otherwise Remotion downloads Chrome Headless Shell),
`ffprobe` optional (used to verify the exported MP4).

## Judge path (≈ 3 minutes)

1. Open the app → حي العليا in 3D with hypothetical projects, the 4-step workflow and the three primary outcomes.
2. Click **عرض سيناريو رصد** for the 10-scene story (≈ 1.5 min, fully controllable), **or** manually:
3. **إدخال المشاريع** → click a road on the map, set closure boundaries, dates, hours, flexibility, lanes.
4. **تحليل التعارض** → evidence-based conflict (geometric / modelled network / proximity-only).
5. **مقارنة البدائل** → the three official alternatives with feasibility, schedule, new conflicts and impact → **إرسال للمراجعة**.
6. **مراجعة القرار** → accept / reject / modify → original vs coordinated plan.
7. **تجربة المواطن** → “خطّط لرحلة الغد قبل مفاجأة الإغلاق”; **مشغّلو النقل** → published closures with lead time.
8. **استوديو المحاكاة** → preview and export the MP4 (`output/rasd-simulation.mp4`).

Keyboard: `Space` play/pause · `R` reset camera · `2`/`3` 2D/3D · `[`/`]` speed · `B` before/after ·
`T` cinematic tour · `N` RASD show (conflict scene) · `G` tutorial · `?` shortcuts.

## What is real vs simulated

| Area | Status |
|---|---|
| Road names, district names | Real Riyadh roads (King Fahd Rd, Olaya St, Al Takhassusi St, Makkah Rd, Prince Mohammed bin Abdulaziz Rd (Tahlia), Al Urubah Rd, King Abdullah Rd) and OSM neighbourhood centroids |
| Road geometry | **Schematic, approximate (±200–400 m)** straight blocks aligned to the real corridor axis, because OpenStreetMap/Overpass was not reachable from the build environment. `npm run data:fetch-osm` (unvalidated here) writes exact OSM geometry to `src/data/osm-geometry.json`, which the network loader uses automatically |
| Basemap & 3D buildings | Online: OpenFreeMap vector tiles (OSM buildings extruded). Offline / blocked network: built-in “digital twin” style with **synthetic procedural massing** (seeded) + approximate landmark towers |
| Projects, organizations | Synthetic, generic organization labels (“مرفق المياه (محاكاة)” …) |
| Traffic | Local static user-equilibrium model (BPR + MSA) on the study network with synthetic gravity demand calibrated to a congested peak; hourly demand profile; deterministic |
| Routing | Local network router (Dijkstra on congested times). OSRM/Valhalla optional via env, not required |
| Economics | Configurable illustrative model (formula shown in UI) |

## 3D prototype — 5 blocks (route `/twin`)

A compact **Riyadh-Inspired Prototype** (stylised after حي النخيل — not a geographically exact
reconstruction): Prince Turki bin Abdulaziz Al Awwal Rd (arterial), Al Nakheel St (diversion
route), Al Wadi St and three cross streets, and a King Abdullah Rd overpass. Three.js runtime with
lane markings, sidewalks, crosswalks, streetlights, Arabic/English signs, construction zones
(barriers, cones, pit, excavator) and instanced vehicles that slow, merge and reroute.

Scenario: normal → Excavation A (main road) → Excavation B (the diversion route) → «كشف التعارض»
→ «تطبيق توصية رصد» (reschedule B after A) → before/after. Plus simulation/camera controls, layer
toggles, historical replay and a ~75 s guided demo. All numbers come from a deterministic local
model and are labelled **DEMO DATA / SIMULATED**. Data access goes through `src/twin/adapter.ts`
(`LocalDemoSource`; `CodexApiSource` activates when `VITE_CODEX_API_URL` is set — its endpoint
paths are placeholders until Codex publishes `docs/CLAUDE_INTEGRATION.md`).

**Buildings and bridge are temporary stand-ins** until the licensed KitBash3D files are supplied.
Blender pipeline (Blender 5.2 as a Python module):

```bash
python3 -m venv .venv-blender && .venv-blender/bin/pip install bpy   # once
mkdir kitbash && cp -r <your KitBash3D export (.blend/.fbx/.obj/.glb + textures)> kitbash/
npm run twin:layout
.venv-blender/bin/python scripts/blender/assemble_rasd_scene.py --kit kitbash
#  → output/blender/rasd-twin.blend  +  public/models/kitbash/twin-scene.glb (+ .report.json)
#  → public/twin/kit-palette.json (colours sampled from the kit's materials)
```

The script builds roads from the shared layout, imports the kit, places the bridge (unscaled spans
tiled along the overpass) and fills the 5 blocks with the kit's buildings (uniform scale only), then
exports. `/twin` loads the GLB automatically, hides the stand-ins and applies the kit palette.
Without kit files it saves a roads-only `.blend` and exports nothing (it never substitutes generic
buildings for the kit). `kitbash/` and `public/models/kitbash/*` are gitignored.

## Optional licensed building models (e.g. KitBash3D)

Licensed kits are **never committed or redistributed** — `public/models/kitbash/` is gitignored.

1. Export each building of your licensed kit to **GLB** (e.g. Blender → File → Export → glTF 2.0, *binary*).
2. Copy the `.glb` files into `public/models/kitbash/`.
3. Run `npm run models:index` (computes each model's bounding box and unit scale → `manifest.json`;
   options `--unit 0.01` for centimetre exports, `--radius`, `--max`, `--name`).
4. Reload: the offline digital twin and the video replace the synthetic blocks inside حي العليا with
   your models (instanced Three.js, aligned to the street grid, matched to each footprint/height).
   Settings shows the kit status; the overlay can be toggled. Without a manifest nothing changes.

`npm run models:sample` writes a tiny self-made placeholder kit (not KitBash) to try the pipeline.
Online vector basemaps keep real OSM buildings; the kit is applied on the offline twin.

## Optional providers (`.env`)

Copy `.env.example` → `.env`. Nothing is required; never put secret keys in `VITE_*` variables.

- `VITE_BASEMAP_DARK` / `VITE_BASEMAP_LIGHT` — MapLibre style URLs (default OpenFreeMap; `offline` forces the built-in twin)
- `VITE_SATELLITE_TILES` — raster tiles from a provider whose terms permit your use (satellite button is disabled otherwise)
- `VITE_TERRAIN_TILES` — DEM tiles for the optional terrain toggle
- `RASD_RENDER_PORT`, `REMOTION_BROWSER` — render worker settings

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full architecture, models, rules and
known limitations. Sample data is exported to [`public/demo-data/`](public/demo-data).

```
src/engine/   spatial · conflicts · routing · traffic · optimization · economics   (pure TS, unit-tested)
src/data/     network, projects (seeded), buildings, organizations
src/store/    Zustand store (localStorage persistence, zod-validated), derived selectors
src/components/  map (MapLibre wrapper), layout, projects, conflicts, optimization, citizen, analytics, tutorial, video
video/        Remotion composition, deterministic Canvas/SVG 2.5D city renderer, camera keyframes
server/       render worker (HTTP) + programmatic Remotion render
scripts/      export-sim, fetch-osm
tests/        unit · integration · e2e
```

## Licences / attribution

Map data © OpenStreetMap contributors (ODbL). OpenFreeMap tiles. MapLibre GL JS (BSD-3). Mapbox
RTL text plugin (BSD-2, vendored in `public/vendor/`). IBM Plex Sans Arabic (OFL). Remotion is
free for individuals and small teams — check the Remotion licence for company use.
