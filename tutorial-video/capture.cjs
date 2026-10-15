'use strict';
// Records the tutorial flow from the live site.
//
//   node capture.cjs <outDir> [--explore-only]
//
// Phase 1 (not recorded) walks the site, checks which of the brief's labels
// really exist, and picks the as-briefed shot or its written alternative.
// Phase 2 replays the chosen plan in a fresh browser while a CDP screencast
// saves every frame at 2x (3840x2160) so later zooms stay sharp.
//
// Writes: <outDir>/frames/*.jpg, frames.json, shots.json, report.json,
// and probe screenshots under <outDir>/probe/.

const fs = require('node:fs');
const path = require('node:path');
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const SITE = process.env.SITE_URL || 'https://islamic-economics-cards.vercel.app/';
const OUT = path.resolve(process.argv[2] || 'out');
const EXPLORE_ONLY = process.argv.includes('--explore-only');
const VW = 1920, VH = 1080, SCALE = 2;
const HELPERS = fs.readFileSync(path.join(__dirname, 'page-helpers.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

const CAPTIONS = {
  s1: 'راجع الاقتصاد الإسلامي بسهولة',
  s2: 'اختر الفصل والموضوع',
  s3: 'اضغط البطاقة… ثم انتقل للتالية',
  s4: { quiz: 'اختبر نفسك', rate: 'قيّم نفسك: عرفتها أو أراجعها' },
  s5: { 'more+theme': 'زد أسئلتك وبدّل الوضع', journey: 'تابع تقدّمك وابدأ من جديد' },
  s6: 'ابدأ مراجعتك',
};
// Output seconds per shot (0–3, 3–6, 6–10, 10–15, 15–18, 18–20).
const TARGET = { s1: 3, s2: 3, s3: 4, s4: 5, s5: 3, s6: 2 };

class Missing extends Error {
  constructor(what) { super(`لم يُعثر على: ${what}`); this.what = what; }
}

async function newPage(browser) {
  const context = await browser.newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: SCALE,
    locale: 'ar-SA', colorScheme: 'light', reducedMotion: 'no-preference',
  });
  await context.addInitScript(HELPERS);
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return { context, page };
}

async function open(page) {
  const resp = await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
  if (!resp || resp.status() >= 400) throw new Missing(`الموقع لم يفتح (HTTP ${resp ? resp.status() : '—'})`);
  await page.waitForFunction(() => window.__tut && document.body && document.body.innerText.trim().length > 0);
  await sleep(700);
}

const ev = (page, fn, ...args) => page.evaluate(fn, ...args);
const tut = (tag) => (page) => page.locator(`[data-tut="${tag}"]`).first();
const textVisible = async (page, re) => page.getByText(re).first().isVisible().catch(() => false);
const inv = (page) => ev(page, () => window.__tut.inventory());

async function waitMark(page, fn, arg, timeout = 2500) {
  const t0 = Date.now();
  for (;;) {
    const r = await page.evaluate(fn, arg).catch(() => null);
    if (r) return r;
    if (Date.now() - t0 > timeout) return null;
    await sleep(150);
  }
}

// ---- pointer movement that the overlay cursor follows -----------------------
let mouse = { x: VW * 0.62, y: VH * 0.72 };
async function moveTo(page, x, y, ms = 380) {
  const steps = Math.max(10, Math.round(ms / 16));
  const sx = mouse.x, sy = mouse.y;
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
    await sleep(ms / steps);
  }
  mouse = { x, y };
}

async function ensureInView(page, loc) {
  const b = await loc.boundingBox();
  if (!b) return;
  if (b.y >= 70 && b.y + b.height <= VH - 160) return;
  await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(650);
}

// Visible click: glide to the control, pause so viewers see it, press.
async function clickOn(page, loc, { pre = 260, post = 360, move = 380 } = {}) {
  await ensureInView(page, loc);
  const b = await loc.boundingBox();
  if (!b) throw new Missing('عنصر غير ظاهر للنقر');
  await moveTo(page, b.x + b.width / 2, b.y + b.height / 2, move);
  await sleep(pre);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(post);
  return b;
}

async function hover(page, loc, hold = 500) {
  await ensureInView(page, loc);
  const b = await loc.boundingBox();
  await moveTo(page, b.x + b.width / 2, b.y + b.height / 2);
  await sleep(hold);
  return b;
}

async function chooseTopic(page, info, visible) {
  const loc = tut('topic')(page);
  if (info.kind === 'select') {
    const idx = info.options.findIndex((t, i) => i !== info.selected && t && !/اختر|الكل|جميع/.test(t));
    if (visible) await clickOn(page, loc, { post: 250 });
    await loc.selectOption({ index: idx >= 0 ? idx : 0 });
    await page.keyboard.press('Escape').catch(() => {});
    info.chosen = info.options[idx >= 0 ? idx : 0];
  } else {
    if (visible) await clickOn(page, loc);
    else await loc.click();
    info.chosen = info.picked;
  }
  await sleep(visible ? 450 : 250);
}

// Steps 2 and 3 up to an open round. Shared by both phases.
async function setupRound(page, found, visible, rec) {
  if (!(await ev(page, () => window.__tut.markNear('اختر الفصل', '^\\s*الأول\\s*$', 'first')))) throw new Missing('زر «الأول» تحت «اختر الفصل»');
  await ev(page, () => window.__tut.markLabel('اختر الفصل', 'chapterLabel'));
  if (rec) {
    await ensureInView(page, tut('first')(page));
    rec.begin('s2');
    rec.cam(union(await tut('chapterLabel')(page).boundingBox(), await tut('first')(page).boundingBox()));
  }
  if (visible) await clickOn(page, tut('first')(page)); else await tut('first')(page).click();

  if (!(await waitMark(page, () => window.__tut.markClickable('تخصيص البطاقات', 'customize')))) throw new Missing('«تخصيص البطاقات ＋»');
  if (rec) { await ensureInView(page, tut('customize')(page)); rec.cam(await tut('customize')(page).boundingBox()); }
  if (visible) await clickOn(page, tut('customize')(page), { post: 500 }); else { await tut('customize')(page).click(); await sleep(500); }

  const topic = await waitMark(page, () => window.__tut.markTopicControl());
  if (!topic) throw new Missing('قائمة «الموضوع»');
  found.topic = topic;
  if (rec) {
    await ensureInView(page, tut('topic')(page));
    rec.cam(union(await tut('topicLabel')(page).boundingBox(), await tut('topic')(page).boundingBox()));
  }
  await chooseTopic(page, topic, visible);
  if (rec) await rec.end();

  if (!(await waitMark(page, () => window.__tut.markClickable('ابدأ جولة', 'start', 60)))) throw new Missing('زر «ابدأ جولة…»');
  found.startLabel = await tut('start')(page).innerText();
  if (rec) {
    await ensureInView(page, tut('start')(page));
    rec.begin('s3');
    rec.cam(await tut('start')(page).boundingBox());
  }
  if (visible) await clickOn(page, tut('start')(page), { post: 700 }); else { await tut('start')(page).click(); await sleep(800); }
}

async function revealCard(page, visible, rec) {
  if (!(await waitMark(page, () => window.__tut.markCard()))) throw new Missing('البطاقة');
  if (rec) rec.cam(await tut('card')(page).boundingBox());
  const before = await ev(page, () => window.__tut.cardState());
  if (visible) await clickOn(page, tut('card')(page), { post: 900 }); else { await tut('card')(page).click(); await sleep(700); }
  const after = await ev(page, () => window.__tut.cardState());
  return before !== after;
}

async function clickNamed(page, re, tag, visible, rec, opts) {
  if (!(await waitMark(page, (src) => window.__tut.markClickable(src, 'tmp'), re))) return false;
  await ev(page, (t) => { const e = document.querySelector('[data-tut="tmp"]'); window.__tut.mark(e, t); }, tag);
  if (rec) rec.cam(await tut(tag)(page).boundingBox());
  if (visible) await clickOn(page, tut(tag)(page), opts); else { await tut(tag)(page).click(); await sleep(250); }
  return true;
}

// Off-camera: run through the rest of the round until «زيادة؟» shows or nothing moves.
async function finishRound(page) {
  for (let i = 0; i < 250; i++) {
    if (await textVisible(page, /زيادة\s*؟/)) return true;
    const moved = await ev(page, () => {
      const T = window.__tut;
      const btn = T.clickables().find((e) => /التالي/.test(T.text(e)) && T.text(e).length <= 20 && !e.disabled);
      if (btn) { btn.click(); return 'next'; }
      if (T.markOptionsAny && T.markOptionsAny()) { document.querySelector('[data-tut="opt"]').click(); return 'opt'; }
      if (T.markCard()) { document.querySelector('[data-tut="card"]').click(); return 'card'; }
      return null;
    });
    if (!moved) break;
    await sleep(120);
  }
  return textVisible(page, /زيادة\s*؟/);
}

async function tryQuiz(page, visible, rec) {
  if (!(await ev(page, () => window.__tut.markQuizToggle()))) return { quiz: false };
  const label = await tut('quiz')(page).innerText().catch(() => '');
  await ev(page, () => window.__tut.rememberButtons());
  if (rec) rec.cam(await tut('quiz')(page).boundingBox());
  if (visible) await clickOn(page, tut('quiz')(page), { post: 800 }); else { await tut('quiz')(page).click(); await sleep(800); }
  const options = await waitMark(page, () => window.__tut.markOptions());
  if (!options) return { quiz: true, label, options: null };
  if (rec) rec.cam(await tut('optBox')(page).boundingBox());
  const before = await ev(page, () => window.__tut.optState());
  if (visible) await clickOn(page, tut('opt')(page), { post: 1500 }); else { await tut('opt')(page).click(); await sleep(1200); }
  const after = await ev(page, () => window.__tut.optState());
  return { quiz: true, label, options, autoCorrect: before !== after };
}

async function themeToggle(page, visible, rec) {
  if (!(await ev(page, () => window.__tut.markThemeToggle()))) return { theme: false };
  const label = await tut('theme')(page).evaluate((e) => e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText.trim());
  const s0 = await ev(page, () => window.__tut.themeState());
  if (rec) rec.cam(await tut('theme')(page).boundingBox());
  if (visible) await clickOn(page, tut('theme')(page), { post: 250 }); else { await tut('theme')(page).click(); await sleep(500); }
  const s1 = await ev(page, () => window.__tut.themeState());
  // The whole page changes, so pull back to show it.
  if (rec) { rec.cam(null, 0.7); await sleep(800); }
  return { theme: true, label, works: s0 !== s1 };
}

function union(...rects) {
  const rs = rects.filter(Boolean);
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.width)), y1 = Math.max(...rs.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---- phase 1 ----------------------------------------------------------------
async function discover(browser, report) {
  const { context, page } = await newPage(browser);
  const found = {};
  const probe = path.join(OUT, 'probe');
  fs.mkdirSync(probe, { recursive: true });
  const snap = async (name) => {
    report.inventory[name] = await inv(page);
    await page.screenshot({ path: path.join(probe, `${name}.png`) });
  };

  await open(page);
  await snap('home');
  found.title = await ev(page, () => window.__tut.markTitle());
  found.themeHome = await ev(page, () => !!window.__tut.markThemeToggle());
  found.journey = await ev(page, () => !!window.__tut.findLabel('رحلتك مع البطاقات'));
  found.restart = await ev(page, () => window.__tut.markClickable('من البداية', 'restart'));

  await setupRound(page, found, false, null);
  await snap('round');
  found.reveal = await revealCard(page, false, null);
  await snap('revealed');
  found.next = await ev(page, () => window.__tut.markClickable('التالية', 'tmp'));
  found.known = await ev(page, () => window.__tut.markClickable('عرفتها', 'tmp'));
  found.review = await ev(page, () => window.__tut.markClickable('أراجعها', 'tmp'));

  // Quiz mode may live inside the round or on the home page.
  let q = await tryQuiz(page, false, null);
  if (!q.quiz) { await open(page); q = await tryQuiz(page, false, null); q.where = 'home'; } else q.where = 'round';
  found.quiz = q;
  if (q.quiz) await snap('quiz');

  // «زيادة؟» after the questions run out: in quiz mode first, then in card mode.
  found.more = false;
  if (q.quiz && q.options) { found.more = await finishRound(page); if (found.more) found.moreMode = 'quiz'; }
  if (!found.more) {
    await open(page);
    await setupRound(page, {}, false, null);
    found.more = await finishRound(page);
    if (found.more) found.moreMode = 'cards';
  }
  await snap('round-end');
  found.theme = await themeToggle(page, false, null);
  await context.close();

  const plan = {
    s4: q.quiz && q.options && q.autoCorrect ? 'quiz' : found.known && found.review ? 'rate' : null,
    s5: found.more && found.theme.theme && found.theme.works ? 'more+theme'
      : found.journey && found.restart ? 'journey' : null,
  };
  report.found = found;
  report.plan = plan;
  return plan;
}

// ---- phase 2 ----------------------------------------------------------------
class Recorder {
  constructor() { this.shots = []; this.cur = null; }
  begin(id, variant = 'as-briefed') {
    const cap = CAPTIONS[id];
    const caption = typeof cap === 'string' ? cap : cap[variant];
    this.cur = { id, variant, caption, target: TARGET[id], start: now(), camera: [] };
    this.shots.push(this.cur);
  }
  // rect in CSS px of the 1920x1080 viewport; null = full frame.
  cam(rect, dur = 0.6, maxZoom = 1.6) {
    this.cur.camera.push({ t: now(), rect: rect && { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, dur, maxZoom });
  }
  async end(minFactor = 1.05) {
    const need = this.cur.target * minFactor - (now() - this.cur.start);
    if (need > 0) await sleep(need * 1000);
    this.cur.end = now();
    this.cur = null;
  }
}

async function record(browser, plan, report) {
  const { context, page } = await newPage(browser);
  const rec = new Recorder();
  await open(page);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  const dir = path.join(OUT, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, t: metadata.timestamp });
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * SCALE, maxHeight: VH * SCALE, everyNthFrame: 1 });
  await sleep(600);

  // s1: still homepage, slow push-in on the title.
  await ev(page, () => window.__tut.hideCursor(true));
  await ev(page, () => window.__tut.markTitle());
  rec.begin('s1');
  rec.cam(null, 0);
  await sleep(200);
  rec.cam(await tut('title')(page).boundingBox(), 2.8, 1.45);
  await rec.end(1.1);
  await page.mouse.move(mouse.x, mouse.y);
  await ev(page, () => window.__tut.hideCursor(false));

  // s2 + start of s3
  const found = {};
  await setupRound(page, found, true, rec);
  await revealCard(page, true, rec);
  if (!(await waitMark(page, () => window.__tut.markClickable('التالية', 'next')))) throw new Missing('«التالية ←»');
  rec.cam(await tut('next')(page).boundingBox());
  await clickOn(page, tut('next')(page), { post: 600 });
  await rec.end();

  // s4
  if (plan.s4 === 'quiz') {
    if (report.found.quiz.where === 'home') { await open(page); }
    rec.begin('s4', 'quiz');
    const q = await tryQuiz(page, true, rec);
    if (!q.autoCorrect) throw new Missing('التصحيح التلقائي في وضع الاختبار');
    await sleep(600);
    await rec.end();
  } else {
    rec.begin('s4', 'rate');
    await revealCard(page, true, rec);
    const shown = await tut('card')(page).innerText().catch(() => '');
    if (!(await clickNamed(page, 'عرفتها', 'known', true, rec, { post: 700 }))) throw new Missing('«✓عرفتها»');
    // «عرفتها» may move on by itself; if the same card is still up, go to the next one.
    await ev(page, () => window.__tut.markCard());
    if ((await tut('card')(page).innerText().catch(() => '')) === shown) {
      await clickNamed(page, 'التالية', 'next', true, null, { post: 500 });
    }
    await revealCard(page, true, rec);
    if (!(await clickNamed(page, 'أراجعها', 'review', true, rec, { post: 700 }))) throw new Missing('«↺أراجعها»');
    await rec.end();
  }

  // s5
  if (plan.s5 === 'more+theme') {
    if (report.found.moreMode === 'cards' && plan.s4 === 'quiz') { await open(page); await setupRound(page, {}, false, null); }
    await finishRound(page);
    await sleep(500);
    rec.begin('s5', 'more+theme');
    const more = page.getByText(/زيادة\s*؟/).first();
    rec.cam(await more.boundingBox());
    await hover(page, more, 700);
    const t = await themeToggle(page, true, rec);
    if (!t.works) throw new Missing('زر الوضع الليلي');
    await rec.end();
    await tut('theme')(page).click(); // back to light, off-camera
  } else {
    // Stay on the current page so the counters keep this run's progress.
    let label = await waitMark(page, () => window.__tut.markLabel('رحلتك مع البطاقات', 'journey'), null, 800);
    if (!label) { await open(page); label = await waitMark(page, () => window.__tut.markLabel('رحلتك مع البطاقات', 'journey')); }
    if (!label) throw new Missing('«رحلتك مع البطاقات»');
    await tut('journey')(page).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await sleep(400);
    rec.begin('s5', 'journey');
    // The section around the heading, so the counters are in shot.
    await tut('journey')(page).evaluate((el) => {
      let n = el;
      while (n.parentElement && n.getBoundingClientRect().height < 220) n = n.parentElement;
      window.__tut.mark(n, 'journeyBox');
    });
    const box = await tut('journeyBox')(page).boundingBox();
    rec.cam(box, 0.7, 1.5);
    await sleep(900);
    if (!(await waitMark(page, () => window.__tut.markClickable('من البداية', 'restart')))) throw new Missing('«↺ من البداية»');
    rec.cam(union(box, await tut('restart')(page).boundingBox()), 0.5, 1.5);
    await clickOn(page, tut('restart')(page), { post: 800 });
    await rec.end();
  }

  // s6: still homepage from the top.
  await open(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await ev(page, () => window.__tut.hideCursor(true));
  await sleep(500);
  rec.begin('s6');
  rec.cam(null, 0);
  await rec.end(1.15);

  await cdp.send('Page.stopScreencast').catch(() => {});
  await sleep(300);
  await context.close();
  return { frames, shots: rec.shots, end: now() };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { site: SITE, startedAt: new Date().toISOString(), inventory: {} };
  // Route through the environment's HTTPS proxy when there is one.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(SITE);
  const proxy = !local && (process.env.HTTPS_PROXY || process.env.https_proxy);
  const browser = await pw.chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  let code = 0;
  try {
    const plan = await discover(browser, report);
    if (!plan.s4 || !plan.s5) throw new Missing(`بديل اللقطة ${!plan.s4 ? '10–15' : '15–18'} غير متاح أيضًا`);
    if (!EXPLORE_ONLY) {
      const r = await record(browser, plan, report);
      fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ scale: SCALE, viewport: [VW, VH], end: r.end, frames: r.frames }));
      fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(r.shots, null, 2));
      console.log(`frames: ${r.frames.length}`);
    }
  } catch (e) {
    report.error = e.what || String(e.stack || e);
    console.error('capture stopped:', report.error);
    code = 2;
  } finally {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log('plan:', JSON.stringify(report.plan || null));
  process.exit(code);
})();
