/**
 * Three.js scene of instanced licensed models, shared by the MapLibre custom layer and the
 * Remotion renderer. Local frame: x = east (m), y = up (m), z = −north (m), origin = ORIGIN.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KitManifest, KitPlacement } from '@/data/kitbash';

export interface LoadedKit {
  manifest: KitManifest;
  placements: KitPlacement[];
  group: THREE.Group;
  models: number;
  instances: number;
}

const loader = new GLTFLoader();

/** Load every GLB referenced by the placements and build InstancedMeshes per mesh. */
export async function buildKitGroup(baseUrl: string, manifest: KitManifest, placements: KitPlacement[]): Promise<LoadedKit> {
  const group = new THREE.Group();
  group.name = 'rasd-kit';
  const byFile = new Map<string, KitPlacement[]>();
  for (const p of placements) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  let models = 0;
  for (const [file, list] of byFile) {
    let gltf;
    try {
      gltf = await loader.loadAsync(`${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(file)}`);
    } catch (e) {
      console.warn('[RASD] could not load model', file, e);
      continue;
    }
    models++;
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    // normalise: footprint centred on origin, base at y = 0
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    const normalise = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const placeMats = list.map((p) =>
      new THREE.Matrix4()
        .makeTranslation(p.east, 0, -p.north)
        .multiply(new THREE.Matrix4().makeRotationY(p.rotation))
        .multiply(new THREE.Matrix4().makeScale(p.scale, p.scale, p.scale))
        .multiply(normalise),
    );
    for (const mesh of meshes) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      const local = mesh.matrixWorld;
      placeMats.forEach((m, i) => inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, local)));
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      inst.name = file;
      group.add(inst);
    }
  }
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x1a1640, 1.4);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-800, 1500, 600);
  group.add(hemi, sun);
  return { manifest, placements, group, models, instances: placements.length };
}
