import * as THREE from 'three';
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput, type Map as MLMap } from 'maplibre-gl';
import { ORIGIN } from '@/data/network';
import type { LoadedKit } from './kitScene';

export const KIT_LAYER_ID = 'rasd-kit-3d';

/** MapLibre custom layer rendering the instanced licensed models with Three.js (shared GL context). */
export function createKitLayer(kit: LoadedKit): CustomLayerInterface {
  const camera = new THREE.Camera();
  const scene = new THREE.Scene();
  scene.add(kit.group);
  let renderer: THREE.WebGLRenderer | null = null;
  let map: MLMap | null = null;
  const origin = maplibregl.MercatorCoordinate.fromLngLat(ORIGIN, 0);
  const s = origin.meterInMercatorCoordinateUnits();
  // local (x east, y up, z −north, metres) → mercator
  const local = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(s, -s, s))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return {
    id: KIT_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, gl) {
      map = m;
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl as WebGLRenderingContext, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl, args: CustomRenderMethodInput) {
      if (!renderer || !map) return;
      const proj = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
      camera.projectionMatrix = proj.multiply(local);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      renderer?.dispose();
      renderer = null;
    },
  };
}
