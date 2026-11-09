/**
 * RASD 3D prototype runtime (Three.js). Interactive, deterministic.
 * Buildings/bridge here are TEMPORARY stand-ins: when `/models/kitbash/twin-scene.glb`
 * (exported from Blender with the licensed KitBash3D kit) exists, it replaces them.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BRIDGE_Y, LANE_W, NODE_BY, ROAD_NAMES, SIDEWALK_W, TWIN_BLOCKS, TWIN_NODES, TWIN_ROADS, roadWidth, type TwinRoad } from './layout';
import { DEMAND, BRIDGE_DEMAND, odKey, type Assignment } from './model';
import type { Excavation } from './adapter';
import { mulberry32 } from '@/utils/random';

/** Neutral palette for the stand-ins. Replaced by colours sampled from the kit once it is supplied. */
export const PALETTE = {
  sky: 0x0b1530,
  fog: 0x111d3c,
  ground: 0x1b2333,
  asphalt: 0x2b2f38,
  marking: 0xe9edf2,
  yellow: 0xf2c94c,
  sidewalk: 0x6b6f78,
  curb: 0x9aa0a8,
  building: [0x55606f, 0x6a7380, 0x4b5563, 0x7b8493, 0x5c6573],
  glass: 0x7fa7d8,
  bridge: 0x8a8f99,
  closure: 0xff5a36,
  hazard: 0xffb020,
  recommended: 0x2fe6a6,
  affected: 0xff3b5c,
};

export interface SceneState {
  active: Excavation[];
  assignment: Assignment;
  vcByRoad: Map<string, number>;
  affected: string[];
  recommendedRoads: string[];
  conflictRoads: string[];
}

interface Vehicle {
  path: { from: string; to: string; road: TwinRoad }[];
  seg: number;
  s: number; // metres along current segment
  lane: number;
  speedMs: number;
  od: string;
}

const ROAD_DIR = (r: TwinRoad, from: string) => {
  const a = NODE_BY.get(from)!.p;
  const b = NODE_BY.get(from === r.from ? r.to : r.from)!.p;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { a, b, len, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len };
};

export type CameraView = 'aerial' | 'street' | 'bridge' | 'construction';

export class TwinScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private raf = 0;
  private last = performance.now();
  paused = false;
  speed = 1;
  showTraffic = true;
  showConstruction = true;
  showRoutes = true;
  private vehicles: Vehicle[] = [];
  private carMesh!: THREE.InstancedMesh;
  private overlays = new Map<string, THREE.Mesh>();
  private zones = new Map<string, THREE.Group>();
  private placeholder = new THREE.Group();
  private state: SceneState | null = null;
  private camTween: { from: THREE.Vector3; to: THREE.Vector3; tf: THREE.Vector3; tt: THREE.Vector3; t: number } | null = null;
  kitLoaded = false;
  onKit?: (status: string) => void;
  private dummy = new THREE.Object3D();
  private rnd = mulberry32(5);
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = !navigator.webdriver;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 6000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 2200;
    this.controls.addEventListener('start', () => (this.camTween = null));
    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 900, 2600);
    this.buildLights();
    this.buildGround();
    this.buildRoads();
    this.buildStreetFurniture();
    this.buildPlaceholderCity();
    this.buildBridge();
    this.buildSigns();
    this.buildVehicles();
    this.setView('aerial', true);
    void this.tryLoadKitScene();
    this.loop();
  }

  // ───────────────────────── static environment ─────────────────────────
  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2238, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(-500, 700, 300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -700;
    c.right = 700;
    c.top = 700;
    c.bottom = -700;
    c.far = 2500;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private buildGround() {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.scene.add(g);
    // block plots (paved/landscaped)
    for (const b of TWIN_BLOCKS) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(b.x1 - b.x0 - 30, 0.3, b.z1 - b.z0 - 30),
        new THREE.MeshStandardMaterial({ color: 0x2c3442, roughness: 0.95 }),
      );
      m.position.set((b.x0 + b.x1) / 2, 0.15, (b.z0 + b.z1) / 2);
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  private buildRoads() {
    const asphalt = new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.92 });
    const sidewalk = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.9 });
    const marking = new THREE.MeshBasicMaterial({ color: PALETTE.marking });
    const yellow = new THREE.MeshBasicMaterial({ color: PALETTE.yellow });
    const dashes: THREE.Matrix4[] = [];
    const solid: THREE.Matrix4[] = [];
    for (const r of TWIN_ROADS) {
      if (r.kind === 'bridge') continue;
      const { a, len, dx, dz } = ROAD_DIR(r, r.from);
      const w = roadWidth(r);
      const ang = Math.atan2(dx, dz);
      const cx = a[0] + (dx * len) / 2;
      const cz = a[1] + (dz * len) / 2;
      const road = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, len + w), asphalt);
      road.position.set(cx, 0.1, cz);
      road.rotation.y = ang;
      road.receiveShadow = true;
      this.scene.add(road);
      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(new THREE.BoxGeometry(SIDEWALK_W, 0.35, len - w), sidewalk);
        sw.position.set(cx + side * (w / 2 + SIDEWALK_W / 2) * Math.cos(ang), 0.17, cz - side * (w / 2 + SIDEWALK_W / 2) * Math.sin(ang));
        sw.rotation.y = ang;
        sw.receiveShadow = true;
        this.scene.add(sw);
      }
      // lane markings: dashed lane dividers, solid edge lines, double yellow / median for arterials
      const lanes = r.lanes;
      const median = r.kind === 'arterial' ? 1 : 0;
      const along = (d: number, off: number, M: THREE.Matrix4[], segLen: number, gap: number) => {
        for (let s = w / 2 + 2; s < len - w / 2 - 2; s += segLen + gap) {
          const px = a[0] + dx * (s + segLen / 2) + -dz * off * -1;
          const pz = a[1] + dz * (s + segLen / 2) + dx * off * -1;
          void d;
          M.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0.22, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(0.18, 0.02, segLen)));
        }
      };
      for (const side of [-1, 1]) {
        for (let k = 1; k < lanes; k++) along(0, side * (median + k * LANE_W), dashes, 3, 6);
        along(0, side * (median + lanes * LANE_W - 0.3), solid, len, 0);
      }
      if (median) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, len - w), new THREE.MeshStandardMaterial({ color: 0x9aa0a8 }));
        m.position.set(cx, 0.3, cz);
        m.rotation.y = ang;
        this.scene.add(m);
      } else along(0, 0, solid, len, 0);
      // per-road status overlay (traffic V/C, highlights)
      const ov = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, len - w), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0, depthWrite: false }));
      ov.rotation.x = -Math.PI / 2;
      ov.rotation.z = ang;
      ov.position.set(cx, 0.26, cz);
      this.scene.add(ov);
      this.overlays.set(r.id, ov);
    }
    const inst = (M: THREE.Matrix4[], mat: THREE.Material) => {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, M.length);
      M.forEach((m, i) => im.setMatrixAt(i, m));
      this.scene.add(im);
    };
    inst(dashes, marking);
    inst(solid, marking);
    void yellow;
    // intersections + zebra crossings
    for (const n of TWIN_NODES.filter((x) => !x.gate && !x.id.startsWith('K'))) {
      const roads = TWIN_ROADS.filter((r) => r.from === n.id || r.to === n.id);
      const w = Math.max(...roads.map(roadWidth));
      const box = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.21, w + 2), asphalt);
      box.position.set(n.p[0], 0.1, n.p[1]);
      this.scene.add(box);
      const stripes: THREE.Matrix4[] = [];
      for (const r of roads) {
        const d = ROAD_DIR(r, n.id);
        const rw = roadWidth(r);
        for (let k = -rw / 2 + 1; k < rw / 2 - 0.5; k += 1.4) {
          const off = w / 2 + 2.5;
          stripes.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(n.p[0] + d.dx * off - d.dz * k, 0.23, n.p[1] + d.dz * off + d.dx * k),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(d.dx, d.dz)),
              new THREE.Vector3(0.7, 0.02, 3),
            ),
          );
        }
      }
      inst(stripes, marking);
    }
  }

  private buildStreetFurniture() {
    const poles: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    for (const r of TWIN_ROADS) {
      if (r.kind === 'bridge') continue;
      const { a, len, dx, dz } = ROAD_DIR(r, r.from);
      const off = roadWidth(r) / 2 + 1.2;
      for (let s = 25; s < len - 15; s += 45)
        for (const side of [-1, 1]) {
          const x = a[0] + dx * s - dz * off * side;
          const z = a[1] + dz * s + dx * off * side;
          poles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 5, z), new THREE.Quaternion(), new THREE.Vector3(0.25, 10, 0.25)));
          lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(x + dz * side * 1.4, 10, z - dx * side * 1.4), new THREE.Quaternion(), new THREE.Vector3(1.6, 0.35, 0.6)));
        }
    }
    const add = (M: THREE.Matrix4[], mat: THREE.Material) => {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, M.length);
      M.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      this.scene.add(im);
    };
    add(poles, new THREE.MeshStandardMaterial({ color: 0x8b93a1, metalness: 0.6, roughness: 0.4 }));
    add(lamps, new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd27a, emissiveIntensity: 0.9 }));
  }

  /** Temporary massing (labelled in the UI) until the KitBash3D Blender scene is supplied. */
  private buildPlaceholderCity() {
    this.placeholder.name = 'placeholder-buildings';
    const rnd = mulberry32(11);
    const winTex = windowTexture();
    for (const b of TWIN_BLOCKS) {
      const pad = 22;
      const cols = b.x1 - b.x0 > 150 ? 3 : 2;
      const rows = Math.max(2, Math.round((b.z1 - b.z0) / 70));
      const cw = (b.x1 - b.x0 - 2 * pad) / cols;
      const rh = (b.z1 - b.z0 - 2 * pad) / rows;
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          if (rnd() < 0.15) continue;
          const tall = b.id === 'BLK-2' && i === 0 && j === 0;
          const h = tall ? 140 : 12 + rnd() * (b.x0 === 0 ? 55 : 30);
          const w = cw * (0.6 + rnd() * 0.25);
          const d = rh * (0.6 + rnd() * 0.25);
          const color = PALETTE.building[Math.floor(rnd() * PALETTE.building.length)];
          const tex = winTex.clone();
          tex.needsUpdate = true;
          tex.repeat.set(Math.max(1, w / 8), Math.max(1, h / 4));
          const mat = new THREE.MeshStandardMaterial({ color, map: tex, roughness: 0.75, metalness: 0.15 });
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          m.position.set(b.x0 + pad + cw * (i + 0.5), h / 2 + 0.3, b.z0 + pad + rh * (j + 0.5));
          m.castShadow = true;
          m.receiveShadow = true;
          this.placeholder.add(m);
        }
    }
    this.scene.add(this.placeholder);
  }

  private bridgeGroup = new THREE.Group();
  private buildBridge() {
    const r = TWIN_ROADS.find((x) => x.kind === 'bridge')!;
    const { a, len, dx, dz } = ROAD_DIR(r, r.from);
    const w = roadWidth(r) + 3;
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE.bridge, roughness: 0.8 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, w), mat);
    deck.position.set(a[0] + (dx * len) / 2, BRIDGE_Y - 0.8, a[1] + (dz * len) / 2);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.bridgeGroup.add(deck);
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, w - 3), new THREE.MeshStandardMaterial({ color: PALETTE.asphalt }));
    top.position.set(deck.position.x, BRIDGE_Y + 0.05, deck.position.z);
    this.bridgeGroup.add(top);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 0.4), new THREE.MeshStandardMaterial({ color: 0xc9ced6 }));
      rail.position.set(deck.position.x, BRIDGE_Y + 0.55, deck.position.z + side * (w / 2 - 0.2));
      this.bridgeGroup.add(rail);
    }
    for (let s = 40; s < len; s += 70) {
      if (Math.abs(a[0] + s) < 30 || Math.abs(a[0] + s - 210) < 22) continue; // keep road crossings clear
      const p = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, BRIDGE_Y - 1.6, 12), mat);
      p.position.set(a[0] + s, (BRIDGE_Y - 1.6) / 2, a[1]);
      p.castShadow = true;
      this.bridgeGroup.add(p);
    }
    this.bridgeGroup.name = 'placeholder-bridge';
    this.scene.add(this.bridgeGroup);
  }

  private buildSigns() {
    const sign = (text: string, sub: string, x: number, z: number, rotY: number, color = '#0f6b3a') => {
      const tex = signTexture(text, sub, color);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      board.position.set(x, 8.5, z);
      board.rotation.y = rotY;
      this.scene.add(board);
      for (const o of [-6, 6]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8.5, 0.3), new THREE.MeshStandardMaterial({ color: 0x7c8592 }));
        p.position.set(x + Math.cos(rotY) * o, 4.25, z - Math.sin(rotY) * o);
        this.scene.add(p);
      }
    };
    sign(ROAD_NAMES.arterial.ar, ROAD_NAMES.arterial.en, -16, 360, 0);
    sign(ROAD_NAMES.secondary.ar, ROAD_NAMES.secondary.en, 226, 360, 0);
    sign(ROAD_NAMES.c2.ar, ROAD_NAMES.c2.en, -110, 58, Math.PI / 2);
    sign(ROAD_NAMES.c1.ar, ROAD_NAMES.c1.en, 110, 318, Math.PI / 2);
    sign(ROAD_NAMES.c3.ar, ROAD_NAMES.c3.en, 110, -202, Math.PI / 2);
    sign(ROAD_NAMES.local.ar, ROAD_NAMES.local.en, -206, 170, 0);
    sign('حي النخيل · الرياض', 'Riyadh-Inspired Prototype', 0, -470, 0, '#1d3b7a');
  }

  // ───────────────────────── construction zones ─────────────────────────
  private zoneFor(e: Excavation): THREE.Group {
    const g = new THREE.Group();
    const r = TWIN_ROADS.find((x) => x.id === e.roadId)!;
    const { a, len, dx, dz } = ROAD_DIR(r, r.from);
    const ang = Math.atan2(dx, dz);
    const s0 = len * e.from;
    const s1 = len * e.to;
    const median = r.kind === 'arterial' ? 1 : 0;
    // closed curbside lanes on both directions
    for (const side of [-1, 1]) {
      const inner = median + (r.lanes - e.lanesClosed) * LANE_W;
      const outer = median + r.lanes * LANE_W;
      const off = (side * (inner + outer)) / 2;
      const wid = outer - inner;
      const cx = a[0] + dx * ((s0 + s1) / 2) - dz * off * -1;
      const cz = a[1] + dz * ((s0 + s1) / 2) + dx * off * -1;
      const pit = new THREE.Mesh(new THREE.BoxGeometry(wid - 1, 0.4, s1 - s0 - 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 }));
      pit.position.set(cx, 0.22, cz);
      pit.rotation.y = ang;
      g.add(pit);
      const soil = new THREE.Mesh(new THREE.ConeGeometry(3, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a48 }));
      soil.position.set(cx + dx * 10, 1.2, cz + dz * 10);
      g.add(soil);
      // barriers (orange/white) along the zone edge
      const barrierMat = new THREE.MeshStandardMaterial({ color: PALETTE.closure, emissive: 0x401000 });
      const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5 });
      for (let s = s0; s <= s1; s += 3.2) {
        const bx = a[0] + dx * s - dz * (side * inner) * -1;
        const bz = a[1] + dz * s + dx * (side * inner) * -1;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 2.6), Math.round(s / 3.2) % 2 ? barrierMat : whiteMat);
        b.position.set(bx, 0.75, bz);
        b.rotation.y = ang;
        b.castShadow = true;
        g.add(b);
      }
      // taper cones
      for (let k = 0; k < 6; k++) {
        const s = s0 - 6 - k * 4;
        const o = side * (inner + (wid * k) / 6);
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 10), new THREE.MeshStandardMaterial({ color: PALETTE.hazard }));
        c.position.set(a[0] + dx * s - dz * o * -1, 0.65, a[1] + dz * s + dx * o * -1);
        g.add(c);
      }
      if (side === 1) g.add(excavator(cx, cz, ang));
    }
    // warning sign
    const tex = signTexture('أعمال حفر — رصد', e.titleAr, '#b45309');
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    board.position.set(a[0] + dx * (s0 - 30) + 14, 4.5, a[1] + dz * (s0 - 30));
    board.rotation.y = ang;
    g.add(board);
    // pulsing beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: PALETTE.hazard, transparent: true, opacity: 0.8 }));
    beacon.position.set(a[0] + dx * ((s0 + s1) / 2), 14, a[1] + dz * ((s0 + s1) / 2));
    beacon.name = 'beacon';
    g.add(beacon);
    g.name = `zone-${e.id}`;
    return g;
  }

  // ───────────────────────── vehicles ─────────────────────────
  private buildVehicles() {
    const n = navigator.webdriver ? 120 : 340;
    const geo = new THREE.BoxGeometry(1.9, 1.5, 4.4);
    geo.translate(0, 0.95, 0);
    this.carMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5 }), n);
    this.carMesh.castShadow = true;
    const colors = [0xf8fafc, 0xcbd5e1, 0x111827, 0x1d4ed8, 0xb91c1c, 0x9ca3af, 0xf8fafc];
    for (let i = 0; i < n; i++) this.carMesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    this.scene.add(this.carMesh);
    this.vehicles = Array.from({ length: n }, () => ({ path: [], seg: 0, s: 0, lane: 0, speedMs: 15, od: '' }));
  }

  private pickOd(): string {
    const all = [...DEMAND, ...BRIDGE_DEMAND];
    const tot = all.reduce((s, d) => s + d.v, 0);
    let r = this.rnd() * tot;
    for (const d of all) if ((r -= d.v) <= 0) return odKey(d.o, d.d);
    return odKey(all[0].o, all[0].d);
  }

  private assignPath(v: Vehicle, randomStart: boolean) {
    if (!this.state) return;
    v.od = this.pickOd();
    const a = this.state.assignment;
    const p = a.paths.get(v.od) ?? [];
    v.path = p.map((li) => ({ from: a.links[li].from, to: a.links[li].to, road: a.links[li].road }));
    v.seg = 0;
    v.lane = Math.floor(this.rnd() * 3);
    if (randomStart && v.path.length) {
      v.seg = Math.floor(this.rnd() * v.path.length);
      v.s = this.rnd() * ROAD_DIR(v.path[v.seg].road, v.path[v.seg].from).len;
    } else v.s = 0;
  }

  // ───────────────────────── state ─────────────────────────
  setState(s: SceneState) {
    const first = !this.state;
    this.state = s;
    // construction zones
    const ids = new Set(s.active.map((e) => e.id));
    for (const [id, g] of this.zones) if (!ids.has(id)) (this.scene.remove(g), this.zones.delete(id));
    for (const e of s.active)
      if (!this.zones.has(e.id)) {
        const g = this.zoneFor(e);
        this.zones.set(e.id, g);
        this.scene.add(g);
      }
    for (const g of this.zones.values()) g.visible = this.showConstruction;
    this.applyOverlays();
    // reroute: every vehicle picks its OD's current path (rerouting is visible immediately)
    for (const v of this.vehicles) this.assignPath(v, first || !v.path.length);
    if (!first) for (const v of this.vehicles) this.assignPath(v, true);
  }

  applyOverlays() {
    if (!this.state) return;
    const s = this.state;
    for (const [id, ov] of this.overlays) {
      const m = ov.material as THREE.MeshBasicMaterial;
      let color: number | null = null;
      let op = 0;
      if (this.showRoutes && s.conflictRoads.includes(id)) ((color = PALETTE.affected), (op = 0.55));
      else if (this.showRoutes && s.recommendedRoads.includes(id)) ((color = PALETTE.recommended), (op = 0.45));
      else if (this.showTraffic) {
        const vc = s.vcByRoad.get(id) ?? 0;
        color = vc > 1.3 ? 0xdc2626 : vc > 1 ? 0xf97316 : vc > 0.75 ? 0xfacc15 : 0x22c55e;
        op = 0.28;
      }
      if (color !== null) m.color.setHex(color);
      m.opacity = op;
    }
  }

  setToggles(t: { traffic?: boolean; construction?: boolean; routes?: boolean }) {
    if (t.traffic !== undefined) this.showTraffic = t.traffic;
    if (t.construction !== undefined) {
      this.showConstruction = t.construction;
      for (const g of this.zones.values()) g.visible = t.construction;
    }
    if (t.routes !== undefined) this.showRoutes = t.routes;
    this.carMesh.visible = this.showTraffic;
    this.applyOverlays();
  }

  // ───────────────────────── camera ─────────────────────────
  setView(v: CameraView, instant = false) {
    const zone = this.state?.active[0];
    const zoneCenter = zone ? this.zoneCenter(zone) : new THREE.Vector3(0, 0, 170);
    const views: Record<CameraView, [THREE.Vector3, THREE.Vector3]> = {
      aerial: [new THREE.Vector3(620, 520, 640), new THREE.Vector3(30, 0, 60)],
      street: [new THREE.Vector3(-9, 2.2, 260), new THREE.Vector3(-4, 3, 100)],
      bridge: [new THREE.Vector3(-260, 28, 470), new THREE.Vector3(60, 8, 430)],
      construction: [zoneCenter.clone().add(new THREE.Vector3(70, 55, 60)), zoneCenter],
    };
    const [pos, target] = views[v];
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camTween = null;
    } else this.camTween = { from: this.camera.position.clone(), to: pos, tf: this.controls.target.clone(), tt: target, t: 0 };
  }

  zoneCenter(e: Excavation) {
    const r = TWIN_ROADS.find((x) => x.id === e.roadId)!;
    const { a, len, dx, dz } = ROAD_DIR(r, r.from);
    const s = (len * (e.from + e.to)) / 2;
    return new THREE.Vector3(a[0] + dx * s, 0, a[1] + dz * s);
  }

  zoom(f: number) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.camera.position.copy(this.controls.target.clone().add(dir.multiplyScalar(f)));
  }

  rotate(rad: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad);
    this.camera.position.copy(this.controls.target.clone().add(off));
  }

  // ───────────────────────── KitBash/Blender scene hook ─────────────────────────
  private async tryLoadKitScene() {
    try {
      const head = await fetch('/models/kitbash/twin-scene.glb', { method: 'HEAD' });
      if (!head.ok || !(head.headers.get('content-type') ?? '').includes('model')) {
        this.onKit?.('missing');
        return;
      }
      const gltf = await new GLTFLoader().loadAsync('/models/kitbash/twin-scene.glb');
      gltf.scene.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      this.scene.add(gltf.scene);
      await this.applyKitPalette();
      this.placeholder.visible = false;
      this.bridgeGroup.visible = false;
      this.kitLoaded = true;
      this.onKit?.('loaded');
    } catch {
      this.onKit?.('missing');
    }
  }

  /** Re-colour the runtime environment with the palette Blender sampled from the kit materials. */
  private async applyKitPalette() {
    try {
      const r = await fetch('/twin/kit-palette.json');
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      const p = (await r.json()) as { colors: string[]; dark?: string; light?: string };
      if (!p.colors?.length) return;
      const dark = new THREE.Color(p.dark ?? p.colors[0]);
      const mid = new THREE.Color(p.colors[Math.floor(p.colors.length / 2)]);
      this.scene.background = dark.clone().multiplyScalar(0.55);
      (this.scene.fog as THREE.Fog).color = dark.clone().multiplyScalar(0.7);
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!m || !('color' in m)) return;
        if (m.color.getHex() === PALETTE.ground) m.color.copy(dark).multiplyScalar(0.6);
        if (m.color.getHex() === PALETTE.sidewalk) m.color.copy(mid).multiplyScalar(0.8);
      });
      this.onKit?.('loaded');
    } catch {
      /* palette optional */
    }
  }

  // ───────────────────────── loop ─────────────────────────
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.camTween) {
      this.camTween.t = Math.min(1, this.camTween.t + dt / 1.6);
      const k = 1 - Math.pow(1 - this.camTween.t, 3);
      this.camera.position.lerpVectors(this.camTween.from, this.camTween.to, k);
      this.controls.target.lerpVectors(this.camTween.tf, this.camTween.tt, k);
      if (this.camTween.t >= 1) this.camTween = null;
    }
    if (!this.paused && this.state) this.stepVehicles(dt * this.speed);
    const t = now / 1000;
    for (const g of this.zones.values()) {
      const b = g.getObjectByName('beacon') as THREE.Mesh | undefined;
      if (b) b.scale.setScalar(1 + 0.35 * Math.sin(t * 5));
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private stepVehicles(dt: number) {
    const s = this.state!;
    const speedMap = new Map<string, number>();
    for (const l of s.assignment.links) speedMap.set(`${l.from}>${l.to}`, l.t0 / s.assignment.time[l.i]);
    const zoneOf = new Map(s.active.map((e) => [e.roadId, e]));
    this.vehicles.forEach((v, i) => {
      if (!v.path.length) {
        this.assignPath(v, false);
        if (!v.path.length) return;
      }
      const seg = v.path[v.seg];
      const d = ROAD_DIR(seg.road, seg.from);
      const ratio = speedMap.get(`${seg.from}>${seg.to}`) ?? 1;
      // in a work zone: reduced lanes, slow down further
      const z = zoneOf.get(seg.road.id);
      const frac = seg.from === seg.road.from ? v.s / d.len : 1 - v.s / d.len;
      const inZone = !!z && frac > z.from - 0.08 && frac < z.to + 0.02;
      const free = (seg.road.speedKmh / 3.6) * (inZone ? 0.45 : 1);
      v.s += free * Math.max(0.12, ratio) * dt * 6;
      if (v.s >= d.len) {
        v.s -= d.len;
        v.seg++;
        if (v.seg >= v.path.length) {
          this.assignPath(v, false);
          if (!v.path.length) return;
        }
      }
      const cur = v.path[v.seg];
      const cd = ROAD_DIR(cur.road, cur.from);
      const lanesOpen = cur.road.lanes - (zoneOf.get(cur.road.id)?.lanesClosed ?? 0);
      const cfrac = cur.from === cur.road.from ? v.s / cd.len : 1 - v.s / cd.len;
      const zz = zoneOf.get(cur.road.id);
      const merge = zz && cfrac > zz.from - 0.08 && cfrac < zz.to + 0.02;
      const lane = Math.min(v.lane % cur.road.lanes, merge ? Math.max(0, lanesOpen - 1) : cur.road.lanes - 1);
      const median = cur.road.kind === 'arterial' || cur.road.kind === 'bridge' ? 1 : 0;
      const off = median + LANE_W * (lane + 0.5);
      // right-hand traffic: offset to the right of travel direction
      const x = cd.a[0] + cd.dx * v.s - cd.dz * off;
      const zPos = cd.a[1] + cd.dz * v.s + cd.dx * off;
      const y = cur.road.kind === 'bridge' ? BRIDGE_Y : 0.2;
      this.dummy.position.set(x, y, zPos);
      this.dummy.rotation.set(0, Math.atan2(cd.dx, cd.dz), 0);
      this.dummy.updateMatrix();
      this.carMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.carMesh.instanceMatrix.needsUpdate = true;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function excavator(x: number, z: number, ang: number) {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222831 });
  const tracks = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 4.6), dark);
  tracks.position.y = 0.6;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.8, 3), yellow);
  body.position.y = 1.9;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x9fb7d3, metalness: 0.4 }));
  cab.position.set(0.6, 3.4, 0.4);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5), yellow);
  boom.position.set(-0.4, 3.4, -2.6);
  boom.rotation.x = -0.6;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 3), yellow);
  arm.position.set(-0.4, 2.6, -5.2);
  arm.rotation.x = 0.9;
  g.add(tracks, body, cab, boom, arm);
  g.traverse((o) => (o.castShadow = true));
  g.position.set(x, 0.2, z);
  g.rotation.y = ang;
  return g;
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#9fb3c8';
  for (let y = 8; y < 64; y += 16) for (let x = 6; x < 64; x += 16) ctx.fillRect(x, y, 9, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(ar: string, en: string, bg: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 148);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.direction = 'rtl';
  ctx.font = '600 44px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(ar, 256, 72, 480);
  ctx.direction = 'ltr';
  ctx.font = '500 28px "IBM Plex Sans Arabic", sans-serif';
  ctx.fillText(en, 256, 124, 480);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
