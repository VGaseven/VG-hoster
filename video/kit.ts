/**
 * Optional licensed building models for the video (same manifest + placements as the map).
 * Rendered with an offscreen Three.js renderer whose camera reproduces CityScene's projection
 * exactly, then composited into the canvas — deterministic frame by frame.
 */
import * as THREE from 'three';
import { staticFile } from 'remotion';
import { KIT_BASE_PATH, assignKitModels, loadKitManifest, replacedBuildingIds } from '@/data/kitbash';
import { buildKitGroup, type LoadedKit } from '@/components/map/kitScene';
import type { Camera } from './components/CityScene';

let kit: LoadedKit | null = null;
let hidden = new Set<string>();
let loading: Promise<void> | null = null;

export function loadVideoKit() {
  loading ??= (async () => {
    const base = staticFile(KIT_BASE_PATH);
    const manifest = await loadKitManifest(base);
    if (!manifest) {
      console.log('[RASD video] no building kit manifest — using built-in massing');
      return;
    }
    const placements = assignKitModels(manifest);
    try {
      const k = await buildKitGroup(base, manifest, placements);
      if (k.models) {
        console.log(`[RASD video] building kit: ${k.models} models, ${k.instances} instances`);
        kit = k;
        hidden = replacedBuildingIds(placements);
      }
    } catch (e) {
      console.warn('[RASD video] kit not used:', e);
    }
  })();
  return loading;
}

export const videoKit = () => kit;
export const videoKitHidden = () => hidden;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
const cam = new THREE.PerspectiveCamera();

/** Render the kit for the given CityScene camera; returns the WebGL canvas (or null). */
export function renderKit(c: Camera, W: number, H: number): HTMLCanvasElement | null {
  if (!kit) return null;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    scene.add(kit.group);
  }
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== W || size.y !== H) renderer.setSize(W, H, false);
  // Same model as makeProjector: distance D (km), focal F = zoom·D (px), pitch p, bearing b.
  const b = (c.bearing * Math.PI) / 180;
  const p = (Math.max(0, Math.min(80, c.pitch)) * Math.PI) / 180;
  const D = (H / c.zoom) * 1.6;
  const F = c.zoom * D;
  const east = (c.cx - D * Math.sin(p) * Math.sin(b)) * 1000;
  const north = (c.cy - D * Math.sin(p) * Math.cos(b)) * 1000;
  const up = D * Math.cos(p) * 1000;
  cam.fov = (2 * Math.atan(H / 2 / F) * 180) / Math.PI;
  cam.aspect = W / H;
  cam.near = D * 80;
  cam.far = D * 40000;
  cam.position.set(east, up, -north);
  cam.up.set(Math.cos(p) * Math.sin(b), Math.sin(p), -Math.cos(p) * Math.cos(b));
  cam.lookAt(c.cx * 1000, 0, -c.cy * 1000);
  cam.updateProjectionMatrix();
  renderer.render(scene!, cam);
  return renderer.domElement;
}
