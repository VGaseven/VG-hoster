#!/usr/bin/env python3
"""Edit the captured frames into the 20-second 1920x1080 tutorial MP4.

    python3 compose.py <captureDir> <out.mp4>

Reads frames.json and shots.json written by capture.cjs. Each shot's source
window is retimed to its slot in the brief, the camera eases toward the
control being used (max 1.6x), one Arabic caption line sits on every shot,
and shots meet with a short crossfade. Also writes <out>.srt, and QA stills
plus timing.json next to the MP4.
"""
import bisect
import json
import math
import os
import subprocess
import sys
from functools import lru_cache
from multiprocessing import Pool

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
XFADE = 0.4  # seconds, centred on each cut
URL_TEXT = 'islamic-economics-cards.vercel.app'
FONT_AR = '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf'
FONT_LAT = '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'

CAP = None  # set in main / worker init


def ease(k):
    k = min(1.0, max(0.0, k))
    return 4 * k ** 3 if k < 0.5 else 1 - (-2 * k + 2) ** 3 / 2


# ---- camera ---------------------------------------------------------------
FULL = (W / 2, H / 2, 1.0)


def clamp_view(cx, cy, z):
    hw, hh = W / 2 / z, H / 2 / z
    return min(max(cx, hw), W - hw), min(max(cy, hh), H - hh), z


def view_for(kf):
    r = kf['rect']
    if not r:
        return FULL
    pad = 56
    w, h = r['w'] + 2 * pad, r['h'] + 2 * pad
    z = max(1.0, min(kf.get('maxZoom', 1.6), W / w, H / h))
    return clamp_view(r['x'] + r['w'] / 2, r['y'] + r['h'] / 2, z)


def lerp_view(a, b, k):
    k = ease(k)
    z = math.exp(math.log(a[2]) + (math.log(b[2]) - math.log(a[2])) * k)
    return clamp_view(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, z)


def build_camera(shot, initial):
    """Precompute where each keyframe's move starts from."""
    kfs = shot['camera']
    starts, prev = [], initial
    for j, kf in enumerate(kfs):
        if j:
            p = kfs[j - 1]
            k = 1.0 if p['dur'] <= 0 else (kf['t'] - p['t']) / p['dur']
            prev = lerp_view(starts[j - 1], view_for(p), k)
        starts.append(prev)
    shot['_starts'] = starts
    shot['_views'] = [view_for(k) for k in kfs]


def camera_at(shot, t):
    kfs = shot['camera']
    j = bisect.bisect_right([k['t'] for k in kfs], t) - 1
    if j < 0:
        return shot['_starts'][0] if kfs else FULL
    kf = kfs[j]
    k = 1.0 if kf['dur'] <= 0 else (t - kf['t']) / kf['dur']
    return lerp_view(shot['_starts'][j], shot['_views'][j], k)


# ---- captions -------------------------------------------------------------
def pill(draw_size, text, font, fg, bg, pad=(46, 20), rtl=True):
    kw = {'direction': 'rtl', 'language': 'ar'} if rtl else {}
    probe = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    x0, y0, x1, y1 = probe.textbbox((0, 0), text, font=font, **kw)
    tw, th = x1 - x0, y1 - y0
    pw_, ph = tw + 2 * pad[0], th + 2 * pad[1]
    img = Image.new('RGBA', (pw_ + 40, ph + 40), (0, 0, 0, 0))
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((20, 24, 20 + pw_, 24 + ph), radius=ph // 2, fill=(0, 0, 0, 70))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((20, 20, 20 + pw_, 20 + ph), radius=ph // 2, fill=bg)
    d.text((20 + pad[0] - x0, 20 + pad[1] - y0), text, font=font, fill=fg, **kw)
    return img


def caption_layer(text, with_url=False, top=False):
    # Noto Sans Arabic has no U+2026; three full stops look the same on screen.
    text = text.replace('\u2026', '...')
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cap = pill(None, text, ImageFont.truetype(FONT_AR, 46), (255, 255, 255, 255), (22, 32, 38, 205))
    y = 40 if top else H - 60 - cap.height + 20
    layer.alpha_composite(cap, ((W - cap.width) // 2, y))
    if with_url:
        url = pill(None, URL_TEXT, ImageFont.truetype(FONT_LAT, 34), (20, 83, 72, 255),
                   (255, 255, 255, 235), pad=(34, 14), rtl=False)
        layer.alpha_composite(url, ((W - url.width) // 2, y - url.height + 12))
    return layer


# ---- frame rendering -------------------------------------------------------
def init_worker(cap):
    global CAP
    CAP = cap
    CAP['layers'] = [caption_layer(s['caption'], s['id'] == 's6', s.get('captionTop', False)) for s in CAP['shots']]


@lru_cache(maxsize=6)
def load(path):
    return Image.open(path).convert('RGB')


def render_shot(i, u):
    s = CAP['shots'][i]
    u = min(max(u, 0.0), s['target'])
    src_t = s['start'] + u * (s['end'] - s['start']) / s['target']
    j = max(0, bisect.bisect_right(CAP['times'], src_t) - 1)
    src = load(os.path.join(CAP['dir'], 'frames', CAP['files'][j]))
    sc = src.width / W
    cx, cy, z = camera_at(s, src_t)
    hw, hh = W / 2 / z, H / 2 / z
    box = ((cx - hw) * sc, (cy - hh) * sc, (cx + hw) * sc, (cy + hh) * sc)
    img = src.resize((W, H), Image.LANCZOS, box=box).convert('RGBA')
    img.alpha_composite(CAP['layers'][i])
    return img


def render(n):
    t = n / FPS
    shots, starts = CAP['shots'], CAP['slot']
    i = max(0, bisect.bisect_right(starts, t) - 1)
    img = render_shot(i, t - starts[i])
    half = XFADE / 2
    if i > 0 and t - starts[i] < half:
        a = 0.5 + (t - starts[i]) / XFADE
        img = Image.blend(render_shot(i - 1, t - starts[i - 1]), img, ease(a))
    elif i + 1 < len(shots) and starts[i + 1] - t < half:
        a = 0.5 - (starts[i + 1] - t) / XFADE
        img = Image.blend(img, render_shot(i + 1, t - starts[i + 1]), ease(a))
    if t < 0.4:  # first caption fades in
        base = render_shot_nocap(0, t)
        img = Image.blend(base, img, ease(t / 0.4))
    return img.convert('RGB').tobytes()


def render_shot_nocap(i, u):
    layers = CAP['layers']
    keep = layers[i]
    layers[i] = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    try:
        return render_shot(i, u)
    finally:
        layers[i] = keep


def srt_time(t):
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def main():
    cap_dir, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    frames = json.load(open(os.path.join(cap_dir, 'frames.json')))
    shots = json.load(open(os.path.join(cap_dir, 'shots.json')))
    fr = sorted(frames['frames'], key=lambda f: f['t'])

    prev = FULL
    for s in shots:
        build_camera(s, FULL if s['id'] == 's1' else prev)
        prev = camera_at(s, s['end'])

    slot, acc = [], 0.0
    for s in shots:
        slot.append(acc)
        acc += s['target']
    total = acc
    cap = {'dir': cap_dir, 'shots': shots, 'slot': slot,
           'times': [f['t'] for f in fr], 'files': [f['file'] for f in fr]}

    timing = []
    for s, a in zip(shots, slot):
        src = s['end'] - s['start']
        n_src = sum(1 for f in fr if s['start'] <= f['t'] <= s['end'])
        timing.append({'shot': s['id'], 'variant': s['variant'], 'caption': s['caption'],
                       'out': [round(a, 3), round(a + s['target'], 3)],
                       'source_seconds': round(src, 3), 'speed': round(src / s['target'], 3),
                       'source_frames': n_src})
        print(f"{s['id']} {a:5.2f}-{a + s['target']:5.2f}s  speed {src / s['target']:.2f}x  "
              f"{n_src} src frames  [{s['variant']}] {s['caption']}")

    with open(os.path.splitext(out)[0] + '.srt', 'w', encoding='utf-8') as f:
        for k, (s, a) in enumerate(zip(shots, slot), 1):
            f.write(f"{k}\n{srt_time(a)} --> {srt_time(a + s['target'])}\n{s['caption']}\n\n")

    n_frames = int(round(total * FPS))
    ff = subprocess.Popen([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map', '0:v', '-map', '1:a', '-t', f'{total:.3f}',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
    ], stdin=subprocess.PIPE)
    with Pool(os.cpu_count(), initializer=init_worker, initargs=(cap,)) as pool:
        for k, buf in enumerate(pool.imap(render, range(n_frames), chunksize=4)):
            ff.stdin.write(buf)
            if k % 60 == 0:
                print(f'  frame {k}/{n_frames}', flush=True)
    ff.stdin.close()
    if ff.wait():
        sys.exit('ffmpeg failed')

    qa = os.path.join(os.path.dirname(out), 'qa')
    os.makedirs(qa, exist_ok=True)
    init_worker(cap)
    for s, a in zip(shots, slot):
        for frac in (0.5, 0.9):
            t = a + s['target'] * frac
            Image.frombytes('RGB', (W, H), render(int(t * FPS))).save(os.path.join(qa, f"{s['id']}_{int(frac * 100)}.jpg"), quality=88)
    json.dump(timing, open(os.path.join(os.path.dirname(out), 'timing.json'), 'w'), ensure_ascii=False, indent=2)
    print('wrote', out)


if __name__ == '__main__':
    main()
