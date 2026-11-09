"""
RASD — Blender scene assembly for the 5-block Riyadh-inspired prototype.

Usage (Blender as a Python module, or `blender -b -P`):
  python scripts/blender/assemble_rasd_scene.py --kit <KITBASH_DIR> \
      [--layout public/twin/layout.json] [--blend output/blender/rasd-twin.blend] \
      [--glb public/models/kitbash/twin-scene.glb] [--palette public/twin/kit-palette.json]

* Builds roads, medians, sidewalks and lane markings from the shared layout (same IDs as the app).
* Imports the licensed KitBash3D kit (.blend / .fbx / .obj / .glb / .gltf) found in --kit,
  classifies BRIDGE/OVERPASS assets vs BUILDINGS by object name and size, places the bridge on the
  King Abdullah Rd overpass alignment and fills the 5 blocks with buildings (kit proportions kept,
  uniform scale only).
* Extracts the kit's dominant material colours → kit-palette.json (the app re-colours roads,
  ground and fog to match).
* Saves the .blend and exports ONLY the kit collection (buildings + bridge) to GLB — roads stay in
  the runtime so traffic overlays line up exactly.
If no kit files are found it builds the road environment only, saves the .blend, and exits with a
clear message (it never substitutes generic buildings for the kit).
"""
import argparse, glob, json, math, os, sys, colorsys
import bpy
from mathutils import Vector

p = argparse.ArgumentParser()
p.add_argument('--kit', required=True)
p.add_argument('--layout', default='public/twin/layout.json')
p.add_argument('--blend', default='output/blender/rasd-twin.blend')
p.add_argument('--glb', default='public/models/kitbash/twin-scene.glb')
p.add_argument('--palette', default='public/twin/kit-palette.json')
p.add_argument('--max-buildings', type=int, default=40)
args = p.parse_args([a for a in sys.argv[1:] if a != '--'] if '--' not in sys.argv else sys.argv[sys.argv.index('--') + 1:])

L = json.load(open(args.layout))
nodes = {n['id']: n for n in L['nodes']}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

def coll(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c

ROADS = coll('RASD_Roads')
KIT = coll('KitBash')

def mat(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m

# three.js (x, z-south) → blender (x, y-north)
def bl(x, z):
    return Vector((x, -z, 0))

def box(name, c, size, loc, rot_z, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    o.rotation_euler[2] = rot_z
    o.data.materials.append(material)
    for cc in o.users_collection:
        cc.objects.unlink(o)
    c.objects.link(o)
    return o

# ── 1. road environment ──────────────────────────────────────────────
M_ASPHALT = mat('asphalt', (0.03, 0.035, 0.045))
M_WALK = mat('sidewalk', (0.18, 0.19, 0.21))
M_MARK = mat('marking', (0.85, 0.87, 0.9), 0.5)
M_GROUND = mat('ground', (0.02, 0.025, 0.035), 1)
box('ground', ROADS, (2400, 2400, 0.1), (0, 0, -0.05), 0, M_GROUND)
for r in L['roads']:
    if r['kind'] == 'bridge':
        continue
    a, b = nodes[r['from']]['p'], nodes[r['to']]['p']
    A, B = bl(*a), bl(*b)
    d = B - A
    ln = d.length
    ang = math.atan2(d.y, d.x) - math.pi / 2
    mid = (A + B) / 2
    w = r['width']
    box(f"road_{r['id']}", ROADS, (w, ln + w, 0.2), (mid.x, mid.y, 0.1), ang, M_ASPHALT)
    nrm = Vector((-d.y, d.x, 0)).normalized()
    for side in (-1, 1):
        o = mid + nrm * side * (w / 2 + L['sidewalkWidth'] / 2)
        box(f"walk_{r['id']}_{side}", ROADS, (L['sidewalkWidth'], max(1, ln - w), 0.35), (o.x, o.y, 0.17), ang, M_WALK)
        for k in range(1, r['lanes']):
            off = (1 if r['kind'] == 'arterial' else 0) + k * L['laneWidth']
            s = w / 2 + 2
            dirv = d.normalized()
            while s < ln - w / 2 - 2:
                pnt = A + dirv * (s + 1.5) + nrm * side * off
                box('dash', ROADS, (0.18, 3, 0.03), (pnt.x, pnt.y, 0.22), ang, M_MARK)
                s += 9
    if r['kind'] == 'arterial':
        box(f"median_{r['id']}", ROADS, (1.6, ln - w, 0.6), (mid.x, mid.y, 0.3), ang, M_WALK)
print(f"[blender] roads built: {len(ROADS.objects)} objects")

# ── 2. KitBash3D import ─────────────────────────────────────────────
kit_files = []
for ext in ('blend', 'fbx', 'obj', 'glb', 'gltf'):
    kit_files += glob.glob(os.path.join(args.kit, '**', f'*.{ext}'), recursive=True)
os.makedirs(os.path.dirname(args.blend) or '.', exist_ok=True)

if not kit_files:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    print(f"[blender] KITBASH ASSETS NOT FOUND in '{args.kit}'. Saved road environment only → {args.blend}. No GLB exported.")
    sys.exit(2)

before = set(bpy.data.objects)
for f in sorted(kit_files):
    ext = f.rsplit('.', 1)[1].lower()
    pre = set(bpy.data.objects)
    try:
        if ext == 'blend':
            with bpy.data.libraries.load(f, link=False) as (src, dst):
                dst.objects = src.objects
            for o in dst.objects:
                if o is not None:
                    KIT.objects.link(o)
        elif ext == 'fbx':
            bpy.ops.import_scene.fbx(filepath=f)
        elif ext == 'obj':
            bpy.ops.wm.obj_import(filepath=f)
        else:
            bpy.ops.import_scene.gltf(filepath=f)
        for o in set(bpy.data.objects) - pre:
            o['rasd_source'] = os.path.basename(f)  # keep the kit asset name (GLB imports name meshes generically)
        print(f"[blender] imported {os.path.basename(f)}")
    except Exception as e:  # one broken asset must not block the scene
        print(f"[blender] SKIPPED {os.path.basename(f)}: {e}")
imported = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
for o in imported:
    for cc in list(o.users_collection):
        cc.objects.unlink(o)
    KIT.objects.link(o)

def bounds(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx

BRIDGE_WORDS = ('bridge', 'overpass', 'flyover', 'viaduct', 'highway', 'ramp', 'jisr')

def label(o):
    names = [o.name, str(o.get('rasd_source', ''))]
    par = o.parent
    while par:
        names.append(par.name)
        par = par.parent
    return ' '.join(names).lower()

def is_bridge(o):
    if any(k in label(o) for k in BRIDGE_WORDS):
        return True
    mn, mx = bounds(o)
    length, height = max(mx.x - mn.x, mx.y - mn.y), mx.z - mn.z
    return length > 60 and length / max(height, 0.1) > 6  # long and low: deck-like

bridges = [o for o in imported if is_bridge(o)]
buildings = sorted([o for o in imported if not is_bridge(o) and (bounds(o)[1].z - bounds(o)[0].z) > 6], key=lambda o: -(bounds(o)[1].z - bounds(o)[0].z))
props = [o for o in imported if o not in bridges and o not in buildings]
print(f"[blender] kit: {len(bridges)} bridge part(s), {len(buildings)} building(s), {len(props)} prop(s)")

def place(o, cx, cy, fit_w, fit_d, rot=0.0):
    mn, mx = bounds(o)
    w, d = max(mx.x - mn.x, 0.01), max(mx.y - mn.y, 0.01)
    s = min(fit_w / w, fit_d / d, 1e9)
    o.scale = o.scale * s
    bpy.context.view_layer.update()
    mn, mx = bounds(o)
    o.location += Vector((cx - (mn.x + mx.x) / 2, cy - (mn.y + mx.y) / 2, -mn.z))
    o.rotation_euler[2] += rot

# bridge on the King Abdullah Rd alignment, deck top at layout bridgeY
k = next(r for r in L['roads'] if r['kind'] == 'bridge')
KA, KB = bl(*nodes[k['from']]['p']), bl(*nodes[k['to']]['p'])
used_bridge = []
if bridges:
    br = max(bridges, key=lambda o: (bounds(o)[1] - bounds(o)[0]).length)
    mn, mx = bounds(br)
    long_axis_x = (mx.x - mn.x) >= (mx.y - mn.y)
    if not long_axis_x:
        br.rotation_euler[2] += math.pi / 2
        bpy.context.view_layer.update()
        mn, mx = bounds(br)
    # keep the kit's proportions: no stretching — tile unscaled spans along the alignment
    span = max(mx.x - mn.x, 0.01)
    total = (KB - KA).length
    n = max(1, math.ceil(total / span))
    x0 = min(KA.x, KB.x) + (total - n * span) / 2
    for i in range(n):
        o = br if i == 0 else br.copy()
        if o is not br:
            o.data = br.data
            KIT.objects.link(o)
        bpy.context.view_layer.update()
        mn2, mx2 = bounds(o)
        target_cx = x0 + span * (i + 0.5)
        o.location += Vector((target_cx - (mn2.x + mx2.x) / 2, KA.y - (mn2.y + mx2.y) / 2, L['bridgeY'] - mx2.z))
    print(f"[blender] bridge placed: {n} unscaled span(s) of {span:.0f} m along King Abdullah Rd")
    used_bridge.append(str(br.get('rasd_source', br.name)))
else:
    print('[blender] WARNING: no bridge/overpass asset found in the kit (name must contain bridge/overpass/viaduct)')

# buildings into the 5 blocks (grid slots, kit proportions preserved)
slots = []
for b in L['blocks']:
    pad = 22
    cols = 3 if b['x1'] - b['x0'] > 150 else 2
    rows = max(2, round((b['z1'] - b['z0']) / 70))
    cw = (b['x1'] - b['x0'] - 2 * pad) / cols
    rh = (b['z1'] - b['z0'] - 2 * pad) / rows
    for i in range(cols):
        for j in range(rows):
            c = bl(b['x0'] + pad + cw * (i + 0.5), b['z0'] + pad + rh * (j + 0.5))
            slots.append((c.x, c.y, cw * 0.85, rh * 0.85))
used_buildings = []
for idx, (cx, cy, fw, fd) in enumerate(slots[: args.max_buildings]):
    if not buildings:
        break
    src = buildings[idx % len(buildings)]
    o = src if idx < len(buildings) else src.copy()
    if o is not src:
        o.data = src.data
        KIT.objects.link(o)
    place(o, cx, cy, fw, fd, rot=(math.pi / 2) * (idx % 2))
    used_buildings.append(str(src.get('rasd_source', src.name)))
for o in buildings[len(slots):] + props:
    o.hide_render = True
    o.hide_viewport = True

# ── 3. palette from the kit's actual materials ──────────────────────
cols = []
for o in [o for o in KIT.objects if not o.hide_render]:
    for slot in o.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                link = n.inputs['Base Color'].links
                if link and link[0].from_node.type == 'TEX_IMAGE' and link[0].from_node.image:
                    img = link[0].from_node.image
                    px = list(img.pixels[:: max(4, (len(img.pixels) // 4000) * 4)])
                    rgb = [sum(px[i::4]) / max(1, len(px[i::4])) for i in range(3)] if len(px) >= 4 else None
                else:
                    rgb = list(n.inputs['Base Color'].default_value)[:3]
                if rgb:
                    cols.append(rgb)
def hexc(c):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(v ** (1 / 2.2) * 255))) for v in c)
uniq = {}
for c in cols:
    uniq.setdefault(tuple(round(v, 2) for v in c), c)
cols = sorted(uniq.values(), key=lambda c: colorsys.rgb_to_hsv(*c)[2])
palette = {
    'source': 'KitBash3D materials (sampled in Blender)',
    'colors': [hexc(c) for c in cols[:: max(1, len(cols) // 8)]][:8],
    'dark': hexc(cols[0]) if cols else None,
    'light': hexc(cols[-1]) if cols else None,
}
os.makedirs(os.path.dirname(args.palette) or '.', exist_ok=True)
json.dump(palette, open(args.palette, 'w'), indent=2)
print(f"[blender] palette: {palette['colors']}")

# ── 4. save + export ────────────────────────────────────────────────
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
for o in bpy.data.objects:
    o.select_set(False)
for o in KIT.objects:
    if not o.hide_render:
        o.select_set(True)
os.makedirs(os.path.dirname(args.glb) or '.', exist_ok=True)
# Blender is z-up / y-north; glTF export converts to y-up, and north becomes −z (matches the app).
bpy.ops.export_scene.gltf(filepath=os.path.abspath(args.glb), export_format='GLB', use_selection=True, export_apply=True)
json.dump({'blend': args.blend, 'glb': args.glb, 'bridge': used_bridge, 'buildings': sorted(set(used_buildings)), 'kit_files': [os.path.basename(f) for f in kit_files]}, open(os.path.splitext(args.glb)[0] + '.report.json', 'w'), indent=2)
print(f"[blender] saved {args.blend} and exported {args.glb}")
