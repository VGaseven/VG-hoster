/** Minimal GLB reader/writer helpers (no DOM) used by the model scripts and tests. */
type Vec3 = [number, number, number];
type Mat4 = number[];

export function readGlbJson(buf: Buffer): any {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const len = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const ident = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n: any): Mat4 {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m: Mat4, p: Vec3): Vec3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/** World-space bounding box from POSITION accessor min/max through the node hierarchy. */
export function glbBounds(json: any): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const visit = (ni: number, parent: Mat4) => {
    const n = json.nodes[ni];
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined)
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc?.min || !acc?.max) continue;
        for (const x of [acc.min[0], acc.max[0]]) for (const y of [acc.min[1], acc.max[1]]) for (const z of [acc.min[2], acc.max[2]]) {
          const p = apply(m, [x, y, z]);
          for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], p[k])), (max[k] = Math.max(max[k], p[k]));
        }
      }
    for (const c of n.children ?? []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const ni of scene?.nodes ?? json.nodes.map((_: unknown, i: number) => i)) visit(ni, ident());
  if (!Number.isFinite(min[0])) throw new Error('no POSITION bounds found');
  return { min, max };
}

/** Build a GLB made of boxes [[w,h,d,yBase,colour]] — used for the self-made sample kit. */
export function writeBoxesGlb(boxes: [number, number, number, number, [number, number, number]][]): Buffer {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const prims: { start: number; count: number; mat: number }[] = [];
  const faces: [Vec3, Vec3[]][] = [
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  ];
  boxes.forEach(([w, h, d, y0], bi) => {
    const start = idx.length;
    for (const [n, vs] of faces) {
      const base = pos.length / 3;
      for (const v of vs) pos.push((v[0] * w) / 2, y0 + ((v[1] + 1) * h) / 2, (v[2] * d) / 2), nor.push(...n);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    prims.push({ start, count: idx.length - start, mat: bi });
  });
  const posBuf = Buffer.from(new Float32Array(pos).buffer);
  const norBuf = Buffer.from(new Float32Array(nor).buffer);
  const idxBuf = Buffer.from(new Uint16Array(idx).buffer);
  const pad = (b: Buffer) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
  const bin = Buffer.concat([pad(posBuf), pad(norBuf), pad(idxBuf)]);
  const mins = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
  const maxs = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
  const json = {
    asset: { version: '2.0', generator: 'RASD sample kit (self-made, CC0)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: prims.map((p) => ({ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 + prims.indexOf(p), material: p.mat })) }],
    materials: boxes.map(([, , , , c]) => ({ pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0.2, roughnessFactor: 0.6 } })),
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: pad(posBuf).length, byteLength: norBuf.length, target: 34962 },
      { buffer: 0, byteOffset: pad(posBuf).length + pad(norBuf).length, byteLength: idxBuf.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mins, max: maxs },
      { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
      ...prims.map((p) => ({ bufferView: 2, byteOffset: p.start * 2, componentType: 5123, count: p.count, type: 'SCALAR' })),
    ],
  };
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, ch(0x4e4f534a, js), ch(0x004e4942, bin)]);
}
