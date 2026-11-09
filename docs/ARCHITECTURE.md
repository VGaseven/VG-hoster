# RASD — Architecture

## 1. Overview

```
            ┌────────────── React 19 + Vite (RTL Arabic UI) ──────────────┐
            │  Layout: Sidebar · TopBar · ContextPanel · Timeline · Map   │
            │  Pages: Overview · Map · Register · Conflicts · Optimize ·   │
            │         Compare · Citizen · Analytics · Studio · Settings     │
            │  Tutorial (11 steps) · Judge Demo (≈2.5 min) · Scenario player│
            └───────────────┬───────────────────────────┬──────────────────┘
                            │ Zustand store (persisted)  │ derived selectors (WeakMap memo)
            ┌───────────────▼───────────────────────────▼──────────────────┐
            │                  Engine (pure TypeScript, no DOM)             │
            │ spatial (Turf) → conflicts → traffic (assignment, simulate,   │
            │ vehicles) → routing (router, journey) → optimization →        │
            │ economics                                                      │
            └───────────────┬───────────────────────────┬──────────────────┘
                            │                           │
           MapLibre GL (RasdMap wrapper)       Remotion composition (video/)
           live 3D digital twin                deterministic Canvas/SVG renderer
                                                    ▲
                                    server/render-server.ts (HTTP worker)
                                    scripts/export-sim.ts (CLI)
```

The **same** network, projects, conflict engine, traffic model and vehicle model feed the live map,
the analytics, the citizen planner and the video. Nothing in the UI or the video is a hard-coded
improvement — every number is computed from the model.

## 2. Data

* `src/data/network.ts` — study network for the Olaya / King Fahd Rd corridor. A local frame
  (`u` along King Fahd Rd ≈ 25° W of N, `v` across) places 3 N–S roads × 4 E–W roads; 26 nodes
  (12 intersections, 14 gates) + 6 zones (OSM neighbourhood centroids / landmarks) linked by
  non-closable local connectors. 31 closable blocks. Geometry is schematic (see README);
  `osm-geometry.json` overrides any block with exact OSM coordinates when available.
* `src/data/projects.ts` — 13 synthetic projects, 5 generic organisations, 4 scenarios,
  1 injected demo project, 10 places, 2 citizen journeys. Costs from seeded PRNG (`DATA_SEED`).
* `src/data/buildings.ts` — seeded procedural massing (offline map + video).

| Scenario | Projects | Expected engine result |
|---|---|---|
| S1 Two conflicting roadworks | P01 water + P02 electricity, same King Fahd Rd block | `direct`, **geometric** (Turf-confirmed overlap); coordinated shared trench recommended |
| S2 Closure blocking a detour | P03 telecom (KFR north) + P04 municipal (Olaya north, full closure) | `detour`, **network** (assignment shows diverted flow onto the other closure) |
| S3 Repeated utility works | P05/P06/P07 on Al Urubah Rd | `sequential` ×3; coordinated window groups all three |
| S4 Critical, no flexibility | P08 critical (zero float) + P09 low priority, Makkah Rd | `direct`, high; only “delay P09” feasible; coordination rejected (incompatible works) |

## 3. Traffic model (`src/engine/traffic`)

* **Demand**: OD matrix among 20 centroids (gates + zones), gravity weights, calibrated (8 passes)
  so the no-closure peak-hour **equilibrium** reaches V/C ≈ 1.2 on the busiest King Fahd Rd block.
  Hourly profile (24 factors) bucketed into 4 bands.
* **Supply**: each block = 2 directed links; capacity 1 800 veh/h/lane; partial closures remove
  lanes and apply a 0.7 work-zone speed factor; full closures remove the link.
  Coordinated projects in the same `coordinationGroup` share one work zone (lanes = max).
* **Assignment**: Method of Successive Averages (20 iterations) with BPR (α 0.15, β 4, cap ×8).
  Zone centroids are never through-nodes. Unserved trips get a 30 min / 12 km penalty.
* **Metrics** (`simulateSchedule`): for every hour of the 92-day horizon — vehicle-hours of delay vs
  the same-band baseline, extra vehicle-km, closure segment-days, closure days, accessibility
  (mean of baseline/current zone→gate times), max V/C. Assignments are memoised by
  `(band, closure-state)`, so a whole-horizon evaluation takes ~0.2–0.5 s.
* **Vehicles** (`vehicles.ts`): N sampled OD trips follow the current equilibrium path; position is a
  pure function of time using congested link times → vehicles slow and bunch (queues) on
  congested links, reroute when closures change, and render identically in Remotion.

## 4. Conflict detection (`src/engine/conflicts/detect.ts`)

Every pair of simulated projects is evaluated. Temporal overlap = date overlap **and** working-hour
overlap. Evidence kinds are kept separate:

| Rule | Test | Evidence kind |
|---|---|---|
| A Direct | same segment ID + temporal overlap; overlap stretch confirmed with Turf | geometric (or network if extents don’t touch) |
| C Detour | closing X reroutes ≥ 1 200 veh/h (or ≥ 40 % of displaced trips) onto Y’s segment | network |
| D Access | joint closure drops a zone’s accessibility ≥ 8 pts and ≥ 4 pts beyond the worst single closure | network |
| B Nearby | ≤ 800 m apart; modeled if OD-movement Jaccard ≥ 15 % or positive interaction delay, else **proximity warning only** | network / proximity |
| E Sequential | same road within 300 m, no temporal overlap, gap ≤ 45 days | geometric / proximity |

Severity = transparent points (category base + geometric bonus + interaction delay + overlap days +
access drop + repetition + critical priority), shown in the UI breakdown. ≥ 65 high, 40–64 medium.
Projects in the same approved coordination group are not reported.

## 5. Optimisation (`src/engine/optimization/optimize.ts`)

For a conflict, three families are generated and each candidate schedule is **re-simulated over the
full horizon and re-checked for conflicts**:

* **A Earlier** — move the lower-priority/more flexible project to finish 1 buffer day before the
  other starts; feasible only if ≥ earliest permitted start.
* **B Delay** — start 1 buffer day after the other ends; feasible only if ≤ latest completion.
* **C Coordinated** — one shared work window/zone, only if on the same block, technically compatible
  categories (`SHARED_ZONE_COMPATIBLE`), same closure type, ≥ 1 lane left open, and all deadlines
  met. Sequential chains on the same block are grouped (S3 → three utilities).

Score = 100 − Σ wᵢ·(metricᵢ / worstᵢ) / Σw × 100 over conflicts, delay, closure-days, detour,
accessibility and schedule shift; weights are user-adjustable and the ranking updates instantly.
If nothing is feasible the UI explains why.

## 6. Approval workflow

Statuses: draft · submitted · conflict_detected · under_review · alternative_proposed · approved ·
rejected · scheduled. `approveOption` applies the schedule changes, sets moved projects to
*scheduled* and the counterpart to *approved*, recomputes conflicts/statuses, and appends an audit
entry (date, option, rationale, previous/updated schedules). “Before” = every project on its
originally proposed schedule; “after” = current. Reset restores the seed (Settings).

## 7. Video pipeline

`video/compositions/RasdVideo.tsx` (7 scenes, 45–60 s, 4 presets). Live WebGL map capture is not
deterministic, so scenes use `video/components/CityScene.tsx`: a perspective projection of the same
network, closures, buildings and vehicle model drawn with Canvas 2D (roads/buildings/vehicles,
painter’s algorithm) plus SVG labels, driven by keyframed cameras that are pure functions of the
frame. Data (`video/data.ts`) is computed by the engine (conflict, three options, recommended
decision, before/after metrics, citizen journey). The Studio page previews it with
`@remotion/player`; export goes through `server/render-server.ts` (the browser never spawns
processes) or `npm run export-sim`.

## 8. Testing

* `tests/unit` — dataset invariants, network connectivity/orientation, Turf geometry, every conflict
  rule, optimiser feasibility/ranking/weights, traffic calibration & determinism, economics.
* `tests/integration/workflow.test.ts` — submission → conflict → options → approval → before/after →
  citizen → CSV.
* `tests/e2e/acceptance.spec.ts` — Playwright acceptance tests (map, 2D/3D, click-to-register,
  conflict evidence, options/approval, compare, citizen, tutorial, clock, scenario player, CSV,
  persistence, judge demo, language).

## 9. Known limitations

* Road geometry is schematic until `data:fetch-osm` is run with network access; intersections and
  connectivity are simplified to the main grid (no interchanges, turn restrictions or signals).
* Static hourly equilibrium — no dynamic queue spill-back; delays are indicative.
* Demand is synthetic; calibrating to real counts (e.g. from the Roads General Authority) would be
  the first production step.
* Satellite/terrain require a licensed provider; OSRM is optional and not used by default.
