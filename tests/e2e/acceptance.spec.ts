import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

async function fresh(page: Page, path = '/') {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await waitMap(page);
}

async function waitMap(page: Page) {
  await page.waitForFunction(() => {
    const m = (window as unknown as { __rasdMap?: { ready: boolean } }).__rasdMap;
    return !!m && m.ready;
  }, null, { timeout: 30_000 });
}

const mapState = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __rasdMap: { map: { getPitch(): number; getCenter(): { lng: number; lat: number }; getZoom(): number } } }).__rasdMap.map;
    return { pitch: m.getPitch(), center: m.getCenter(), zoom: m.getZoom() };
  });

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rasd-state-v1') ?? '{}').state);

test('TEST 1 — opens on a 3D map of Riyadh with simulation badge', async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId('main-map').locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.getByTestId('sim-badge').first()).toBeVisible();
  const s = await mapState(page);
  expect(s.center.lng).toBeGreaterThan(46.6);
  expect(s.center.lng).toBeLessThan(46.75);
  expect(s.center.lat).toBeGreaterThan(24.65);
  expect(s.center.lat).toBeLessThan(24.78);
  await expect(page.getByTestId('conflict-count')).not.toHaveText('0');
});

test('TEST 2 — switches between 2D and 3D camera views', async ({ page }) => {
  await fresh(page, '/map');
  await page.getByTestId('toggle-3d').click();
  await expect.poll(async () => (await mapState(page)).pitch, { timeout: 5000 }).toBeLessThan(1);
  await page.getByTestId('toggle-3d').click();
  await expect.poll(async () => (await mapState(page)).pitch, { timeout: 5000 }).toBeGreaterThan(40);
});

test('TEST 3/4/13 — click a road, register a project, get an evidence-based conflict, persists after reload', async ({ page }) => {
  await fresh(page, '/register');
  // click on the map on King Fahd Rd (Tahlia–Al Urubah block), away from existing project pins
  const pts = await page.evaluate(() => {
    const w = window as unknown as {
      __rasdMap: { map: { project(c: [number, number]): { x: number; y: number }; jumpTo(o: object): void } };
      __rasdSegments: Record<string, { coords: [number, number][] }>;
    };
    const [a, b] = w.__rasdSegments['KFR-THL-URB'].coords;
    const at = (f: number): [number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    w.__rasdMap.map.jumpTo({ center: at(0.1), zoom: 15.5, pitch: 0, bearing: 0, padding: { left: 0, right: 0, top: 0, bottom: 0 } });
    return [w.__rasdMap.map.project(at(0.06)), w.__rasdMap.map.project(at(0.14))];
  });
  await page.waitForTimeout(1500);
  const box = (await page.getByTestId('main-map').boundingBox())!;
  await page.mouse.click(box.x + pts[0].x, box.y + pts[0].y);
  await expect(page.getByTestId('segment-select')).toHaveValue('KFR-THL-URB');
  await page.mouse.click(box.x + pts[1].x, box.y + pts[1].y);
  await page.getByTestId('f-title').fill('تمديد كابلات اتصالات اختبارية');
  await page.getByTestId('f-org').selectOption('telecom');
  await page.getByTestId('f-category').selectOption('telecom');
  await page.getByTestId('f-start').fill('2026-12-10');
  await page.getByTestId('f-end').fill('2026-12-20');
  await page.getByTestId('f-lanes').fill('2');
  await page.getByTestId('submit-project').click();
  await expect(page.getByTestId('register-result')).toBeVisible();
  await expect(page.getByTestId('register-conflicts')).toBeVisible();
  await page.getByRole('button', { name: 'عرض تفاصيل التعارض' }).click();
  await expect(page.getByTestId('conflict-warning')).toBeVisible();
  await page.getByTestId('conflict-evidence').click();
  await expect(page.getByRole('dialog')).toContainText('الأدلة الكاملة');
  await page.keyboard.press('Escape');
  // persistence
  await page.reload();
  await waitMap(page);
  const st = await stored(page);
  expect(st.projects.some((p: { id: string; title: string }) => p.id === 'RASD-U01' && p.title.includes('اختبارية'))).toBe(true);
  await page.goto('/');
  await expect(page.getByTestId('project-row-RASD-U01')).toBeVisible();
});

test('form validation shows meaningful errors', async ({ page }) => {
  await fresh(page, '/register');
  await page.getByTestId('submit-project').click();
  await expect(page.getByText('اختر مقطع الطريق من الخريطة أو القائمة').first()).toBeVisible();
  await expect(page.getByText('العنوان قصير جداً').first()).toBeVisible();
});

test('TEST 5/6/7 — three alternatives, approve, timeline changes, before/after metrics differ', async ({ page }) => {
  await fresh(page, '/optimize');
  await page.getByTestId('opt-conflict-select').selectOption('C-RASD-P01-RASD-P02');
  for (const k of ['earlier', 'delay', 'coordinated']) await expect(page.getByTestId(`option-${k}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('option-coordinated')).toContainText('الخيار الموصى به');
  const before = (await stored(page)).projects.find((p: { id: string }) => p.id === 'RASD-P02').schedule;
  await page.getByTestId('apply-coordinated').click();
  await page.getByTestId('confirm-approve').click();
  await expect(page.getByTestId('compare-page')).toBeVisible();
  const after = (await stored(page)).projects.find((p: { id: string }) => p.id === 'RASD-P02');
  expect(after.schedule).not.toEqual(before);
  expect(after.status).toBe('scheduled');
  expect((await stored(page)).audit[0].action).toBe('approve_option');
  await expect(page.getByTestId('compare-metrics')).toBeVisible();
  const delta = await page.getByTestId('delta-تأخير المركبات (م-س)').textContent();
  expect(delta).toMatch(/-\d/); // modeled reduction, computed not hard-coded
  await page.getByTestId('mode-slider').click();
  await expect(page.getByTestId('compare-slider')).toBeVisible();
});

test('TEST 8 — citizen previews an approved future closure with an alternative', async ({ page }) => {
  await fresh(page, '/citizen');
  await page.getByTestId('journey-J1').click();
  await expect(page.getByTestId('citizen-advisory')).toBeVisible();
  await expect(page.getByTestId('citizen-advisory')).toContainText('طريق الملك فهد');
  await page.getByTestId('trip-date').fill('2027-02-27');
  await expect(page.getByTestId('citizen-clear')).toBeVisible();
});

test('TEST 9 — completes the interactive tutorial', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-tour="nav-tutorial"]').click();
  await expect(page.getByTestId('tutorial')).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.getByTestId('tutorial-next').click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('tutorial-title')).toHaveText('صدّر فيديو المحاكاة');
  await page.getByTestId('tutorial-back').click();
  await page.getByTestId('tutorial-next').click();
  await page.getByTestId('tutorial-finish').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
});

test('TEST 10 — play, pause and reset the scenario clock', async ({ page }) => {
  await fresh(page);
  const d0 = await page.getByTestId('date-input').inputValue();
  await page.getByTestId('speed-4').click();
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(2500);
  await page.getByTestId('play-toggle').click();
  const d1 = await page.getByTestId('date-input').inputValue();
  expect(d1 > d0).toBe(true);
  await page.waitForTimeout(800);
  expect(await page.getByTestId('date-input').inputValue()).toBe(d1);
  await page.getByTestId('restart').click();
  await expect(page.getByTestId('date-input')).toHaveValue('2026-12-01');
});

test('conflict scenario player walks all 11 stages and opens optimization', async ({ page }) => {
  await fresh(page, '/conflicts?scenario=1');
  await expect(page.getByTestId('scenario-player')).toBeVisible();
  await page.getByTestId('stage-pause').click();
  for (let i = 0; i < 9; i++) await page.getByTestId('stage-next').click();
  await expect(page.getByTestId('stage-title')).toHaveText('الأثر المروري المُنمذج');
  await page.getByTestId('stage-back').click();
  await expect(page.getByTestId('stage-title')).toHaveText('محاكاة إعادة توجيه الحركة');
  await page.getByTestId('stage-next').click();
  await page.getByTestId('stage-next').click();
  await expect(page.getByTestId('optimize-page')).toBeVisible();
  expect((await stored(page)).projects.some((p: { id: string }) => p.id === 'RASD-D01')).toBe(true);
});

test('TEST 11 — exports scenario metrics to CSV', async ({ page }) => {
  await fresh(page, '/analytics');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
  const file = await dl.path();
  const csv = fs.readFileSync(file!, 'utf8');
  expect(csv).toContain('summary');
  expect(csv).toContain('vehicleHoursDelay');
  expect(csv.split('\n').filter((l) => l.startsWith('"daily"')).length).toBe(92);
});

test('judge demo mode starts and can be stopped', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-tour="judge-demo"]').click();
  await expect(page.getByTestId('demo-caption')).toBeVisible();
  await page.waitForTimeout(7500);
  await expect(page).toHaveURL(/\/map$/);
  await page.getByTestId('demo-stop').click();
  await expect(page.getByTestId('judge-demo')).toHaveCount(0);
});

test('language toggle switches UI chrome to English', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('lang-toggle').click();
  await expect(page.getByRole('link', { name: 'Conflict Detection' })).toBeVisible();
});
