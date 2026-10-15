'use strict';
// Site-specific recording for islamic-economics-cards.vercel.app, written after
// checking the live UI (labels differ from the brief; see README).
//   node capture-site.cjs <outDir>
const fs = require('node:fs');
const path = require('node:path');
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }

const SITE = 'https://islamic-economics-cards.vercel.app/';
const OUT = path.resolve(process.argv[2] || 'out-site');
const VW = 1920, VH = 1080, SCALE = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

class Recorder {
  constructor() { this.shots = []; }
  begin(id, variant, caption, target) { this.cur = { id, variant, caption, target, start: now(), camera: [] }; this.shots.push(this.cur); }
  cam(r, dur = 0.6, maxZoom = 1.6) { this.cur.camera.push({ t: now(), rect: r && { x: r.x, y: r.y, w: r.width, h: r.height }, dur, maxZoom }); }
  async end(f = 1.05) { const need = this.cur.target * f - (now() - this.cur.start); if (need > 0) await sleep(need * 1000); this.cur.end = now(); }
}
const union = (...rs) => { rs = rs.filter(Boolean); const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)); return { x: x0, y: y0, width: Math.max(...rs.map((r) => r.x + r.width)) - x0, height: Math.max(...rs.map((r) => r.y + r.height)) - y0 }; };

(async () => {
  fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
  const proxy = process.env.HTTPS_PROXY;
  const browser = await pw.chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: SCALE, locale: 'ar-SA', colorScheme: 'light' });
  await context.addInitScript(fs.readFileSync(path.join(__dirname, 'page-helpers.js'), 'utf8'));
  const page = await context.newPage();
  const B = (t) => page.locator('button:visible', { hasText: t }).first();
  let mouse = { x: VW * 0.62, y: VH * 0.75 };
  const moveTo = async (x, y, ms = 380) => { const n = Math.round(ms / 16), sx = mouse.x, sy = mouse.y; for (let i = 1; i <= n; i++) { const k = ease(i / n); await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k); await sleep(ms / n); } mouse = { x, y }; };
  const inView = async (loc) => { const b = await loc.boundingBox(); if (b.y >= 70 && b.y + b.height <= VH - 170) return; await loc.evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' })); await sleep(650); };
  const click = async (loc, post = 380, pre = 260) => { await inView(loc); const b = await loc.boundingBox(); await moveTo(b.x + b.width / 2, b.y + b.height / 2); await sleep(pre); await page.mouse.down(); await sleep(80); await page.mouse.up(); await sleep(post); return b; };

  await page.goto(SITE, { waitUntil: 'networkidle' });
  await sleep(800);
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, t: metadata.timestamp });
    fs.writeFileSync(path.join(OUT, 'frames', file), Buffer.from(data, 'base64'));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * SCALE, maxHeight: VH * SCALE });
  await sleep(600);
  const rec = new Recorder();

  // off-camera: get past the opening screen (it also hides itself after a few seconds)
  if (await page.locator('#start-studying').isVisible()) await page.locator('#start-studying').click();
  await sleep(1200);
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(500);

  // s1 homepage top, slow push-in on the title
  await page.evaluate(() => window.__tut.hideCursor(true));
  const title = page.locator('h1:visible').first();
  rec.begin('s1', 'as-briefed', 'راجع الاقتصاد الإسلامي بسهولة', 3);
  rec.cam(null, 0); await sleep(200);
  rec.cam(await title.boundingBox(), 2.8, 1.45);
  await rec.end(1.1);
  await page.mouse.move(mouse.x, mouse.y);
  await page.evaluate(() => window.__tut.hideCursor(false));

  // s2 chapter → topic (topic list opens under «الفصل الأول ⌄»)
  const ch = B('الفصل الأول');
  rec.begin('s2', 'changed', 'اختر الفصل والموضوع', 3);
  rec.cam(union(await B('مراجعة شاملة').boundingBox(), await B('الفصل الثالث').boundingBox(), await ch.boundingBox()), 0.6);
  await click(ch, 450);
  const topic = B('أدلة');
  rec.cam(union(await ch.boundingBox(), await topic.boundingBox()), 0.5);
  await click(topic, 500);
  await rec.end();

  // s3 tap card → answer → swipe left to next
  const card = page.locator('.flashcard:visible').first();
  await card.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(400);
  rec.begin('s3', 'changed', 'اضغط البطاقة… ثم اسحب للتالية', 4);
  rec.cam(await card.boundingBox(), 0.6, 1.35);
  await click(card, 1300);
  const cb = await card.boundingBox();
  await moveTo(cb.x + cb.width * 0.72, cb.y + cb.height / 2); await sleep(250);
  await page.mouse.down();
  const sx = mouse.x;
  for (let i = 1; i <= 30; i++) { await page.mouse.move(sx - ease(i / 30) * 420, mouse.y); await sleep(16); }
  await page.mouse.up(); mouse.x = sx - 420; await sleep(1000);
  await rec.end();

  // s4 quiz: pick an answer, auto-correction shows
  const quizBtn = B('اختبار');
  rec.begin('s4', 'as-briefed', 'اختبر نفسك', 5);
  await quizBtn.evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' })); await sleep(500);
  rec.cam(await page.locator('[aria-label="طريقة الدراسة"]').boundingBox(), 0.6);
  await click(quizBtn, 800);
  const opts = page.locator('.quiz-option:visible');
  await opts.first().evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' })); await sleep(600);
  rec.cam(union(await page.locator('.quiz-card:visible').first().boundingBox(), await opts.last().boundingBox()), 0.6, 1.3);
  await click(opts.nth(1), 400);
  const fb = page.getByText(/إجابة (غير )?صحيحة/).first();
  await sleep(300);
  rec.cam(union(await opts.first().boundingBox(), await fb.boundingBox().catch(() => null)), 0.6, 1.5);
  await sleep(1500);
  await rec.end();

  // off-camera: finish the set to reach the results screen
  for (let i = 0; i < 60; i++) {
    if (await B('عرض النتيجة').isVisible().catch(() => false)) { await B('عرض النتيجة').click(); break; }
    const nx = B('السؤال التالي');
    if (await nx.isVisible().catch(() => false)) { await nx.click(); await sleep(250); continue; }
    await page.locator('.quiz-option:visible:not([disabled])').first().click({ timeout: 2000 }).catch(() => {}); await sleep(250);
  }
  await sleep(900);
  const more = page.locator('#more-cards');
  const moreText = (await more.innerText()).trim();
  // keep «زيادة؟» in the upper half so the caption never covers it
  await more.evaluate((e) => { const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - 380); }); await sleep(400);

  // s5 «زيادة؟» then night mode
  rec.begin('s5', 'as-briefed', 'زد أسئلتك وبدّل الوضع', 3);
  rec.cur.captionTop = true; // «زيادة؟» sits at the very bottom of the page
  rec.cam(union(await more.boundingBox(), await page.locator('#completion-note').boundingBox()), 0.5, 1.5);
  { const mb = await more.boundingBox(); await moveTo(mb.x + mb.width / 2, mb.y + mb.height / 2); await sleep(700); } // point, don't click
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await sleep(600);
  const theme = page.locator('button.theme-button');
  rec.cam(null, 0.6);
  await click(theme, 900);
  await rec.end();

  // s6 closing: opening screen again, still
  await theme.click(); // back to light
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__tut.hideCursor(true)); await sleep(500);
  rec.begin('s6', 'as-briefed', 'ابدأ مراجعتك', 2);
  rec.cam(null, 0);
  await rec.end(1.15);

  await cdp.send('Page.stopScreencast').catch(() => {});
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ scale: SCALE, frames }));
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(rec.shots, null, 2));
  console.log('frames', frames.length, 'moreText', moreText);
  await browser.close();
})();
