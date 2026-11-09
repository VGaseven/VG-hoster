# رصد | RASD — Naqlthon 5 prototype

**Coordinate before closing. Predict before disrupting.**
**ننسق قبل الإغلاق، ونتنبأ قبل التعطيل.**

RASD is an Arabic-first (RTL), desktop-first 3D GIS decision-support prototype for coordinating
road closures in Riyadh. It demonstrates one connected workflow:

> Project submission → spatial analysis → conflict detection → impact simulation →
> schedule optimization → government approval → citizen notification → video export

> ⚠️ **All project records are synthetic.** Traffic values come from a local simulation model
> (synthetic demand), not real telemetry. Economic figures use configurable, illustrative
> assumptions — not official Saudi statistics. The UI shows a permanent **SIMULATION DATA** badge.

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
| `npm run data:fetch-osm` | (needs Overpass access) replace schematic road geometry with exact OSM geometry |

`export-sim` options: `-- --preset 1080p|4k|vertical|square --duration 45..60 --camera cinematic|orbit|topdown --no-captions --no-metrics --out <file>`.

Requirements: Node 20+ (tested on Node 22), Chromium/Chrome for rendering (auto-detected from
`/opt/pw-browsers`, or set `REMOTION_BROWSER`; otherwise Remotion downloads Chrome Headless Shell),
`ffprobe` optional (used to verify the exported MP4).

## Judge path (≈ 3 minutes)

1. Open the app → the 3D Olaya / King Fahd Rd digital twin loads with projects, alerts and moving simulated vehicles.
2. Click **عرض الحكام** (Judge Demo) for an automated ~2.5-minute story, **or** manually:
3. **محاكاة تعارض جديد** → an 11-stage replayable scenario (pause / back / skip / reset).
4. **مركز تحسين الجدولة** → three calculated alternatives with a transparent weighted score → **تطبيق الحل**.
5. **مقارنة السيناريوهات** → split-screen / slider before-vs-after with model-computed deltas.
6. **تجربة المواطن** → “خطط لمشوار بكرة من اليوم”: approved closure, alternative route, best departure time.
7. **استوديو المحاكاة** → preview and export the MP4.

Keyboard: `Space` play/pause · `R` reset camera · `2`/`3` 2D/3D · `[`/`]` speed · `B` before/after ·
`T` cinematic tour · `N` new conflict scenario · `G` tutorial · `?` shortcuts.

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
