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

test('TEST 5/6/7 — three official alternatives, decision review (accept), schedules change, plans compared', async ({ page }) => {
  await fresh(page, '/optimize');
  await page.getByTestId('opt-conflict-select').selectOption('C-RASD-P01-RASD-P02');
  for (const k of ['earlier', 'delay', 'coordinated']) await expect(page.getByTestId(`option-${k}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('option-earlier')).toContainText('تقديم الموعد حسب المرونة');
  await expect(page.getByTestId('option-delay')).toContainText('تأخير الموعد حسب الأولوية');
  await expect(page.getByTestId('option-coordinated')).toContainText('نافذة مشتركة إذا أمكن فنيًا');
  // shared window is never auto-recommended and needs technical confirmation
  await expect(page.getByTestId('option-coordinated')).not.toContainText('الخيار الموصى به');
  await page.getByTestId('apply-coordinated').click();
  await expect(page.getByTestId('confirm-approve')).toBeDisabled();
  await page.getByTestId('tech-confirm').check();
  await expect(page.getByTestId('confirm-approve')).toBeEnabled();
  const before = (await stored(page)).projects.find((p: { id: string }) => p.id === 'RASD-P02').schedule;
  await page.getByTestId('confirm-approve').click();
  await expect(page.getByTestId('compare-page')).toBeVisible();
  const st = await stored(page);
  const after = st.projects.find((p: { id: string }) => p.id === 'RASD-P02');
  expect(after.schedule).not.toEqual(before);
  expect(after.status).toBe('scheduled');
  expect(after.coordinationGroup).toBeTruthy();
  expect(st.audit[0].action).toBe('approve_option');
  await expect(page.getByTestId('compare-metrics')).toContainText('النتائج الرئيسية');
  await expect(page.getByTestId('delta-تأخير المركبات (م-س)')).toHaveText(/-\d/);
  await page.getByTestId('mode-slider').click();
  await expect(page.getByTestId('compare-slider')).toBeVisible();
});

test('decision review — reject with reason, then modify dates within constraints', async ({ page }) => {
  await fresh(page, '/optimize');
  await page.getByTestId('opt-conflict-select').selectOption('C-RASD-P08-RASD-P09');
  await expect(page.getByTestId('option-delay')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('apply-delay').click();
  await page.getByTestId('decision-reject').click();
  await expect(page.getByTestId('confirm-reject')).toBeDisabled();
  await page.getByTestId('decision-rationale').fill('يتعارض مع فعالية في الحي');
  await page.getByTestId('confirm-reject').click();
  expect((await stored(page)).audit[0].action).toBe('reject_option');
  await page.getByTestId('apply-delay').click();
  await page.getByTestId('decision-modify').click();
  await page.getByTestId('modify-start-RASD-P09').fill('2027-03-01');
  await expect(page.getByTestId('confirm-approve')).toBeDisabled(); // beyond latest completion
  await page.getByTestId('modify-start-RASD-P09').fill('2027-01-20');
  await expect(page.getByTestId('confirm-approve')).toBeEnabled();
  await page.getByTestId('confirm-approve').click();
  const st = await stored(page);
  expect(st.audit[0].action).toBe('modify_option');
  expect(st.projects.find((p: { id: string }) => p.id === 'RASD-P09').schedule.start).toBe('2027-01-20');
});

test('TEST 8 — citizen previews an approved future closure with an alternative', async ({ page }) => {
  await fresh(page, '/citizen');
  await page.getByTestId('journey-J1').click();
  await expect(page.getByTestId('citizen-advisory')).toBeVisible();
  await expect(page.getByTestId('citizen-advisory')).toContainText('طريق الملك فهد');
  await expect(page.getByRole('heading', { name: 'خطّط لرحلة الغد قبل مفاجأة الإغلاق' })).toBeVisible();
  await page.getByTestId('trip-date').fill('2027-02-27');
  await expect(page.getByTestId('citizen-clear')).toBeVisible();
});

test('TEST 9 — completes the interactive tutorial (official workflow)', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-tour="nav-tutorial"]').click();
  await expect(page.getByTestId('tutorial')).toBeVisible();
  for (let i = 0; i < 11; i++) {
    await page.getByTestId('tutorial-next').click();
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId('tutorial-title')).toHaveText('عرض سيناريو رصد وتصدير الفيديو');
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

test('«عرض سيناريو رصد» — 10 controllable scenes from project data to results', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-tour="judge-demo"]').click();
  await expect(page.getByTestId('rasd-show')).toBeVisible();
  await page.getByTestId('show-pause').click();
  await expect(page.getByTestId('show-title')).toContainText('حي العليا');
  await page.getByTestId('show-next').click();
  await page.getByTestId('show-next').click();
  await expect(page.getByTestId('show-title')).toContainText('مشروع ثانٍ');
  expect((await stored(page)).projects.some((p: { id: string }) => p.id === 'RASD-D01')).toBe(true);
  await page.getByTestId('show-next').click();
  await expect(page).toHaveURL(/\/conflicts$/);
  await expect(page.getByTestId('conflict-warning')).toBeVisible();
  await page.getByTestId('show-next').click();
  await page.getByTestId('show-next').click();
  await expect(page.getByTestId('option-delay')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('show-back').click(); // replayable / manual navigation
  await expect(page.getByTestId('show-title')).toHaveText('فتح البدائل الثلاثة');
  for (let i = 0; i < 4; i++) await page.getByTestId('show-next').click();
  await expect(page).toHaveURL(/\/citizen$/);
  expect((await stored(page)).audit.some((a: { action: string }) => a.action === 'approve_option')).toBe(true);
  await page.getByTestId('show-next').click();
  await expect(page.getByTestId('show-results')).toBeVisible();
  await page.getByTestId('show-replay').click();
  await page.getByTestId('show-close').click();
  await expect(page.getByTestId('rasd-show')).toHaveCount(0);
});

test('stakeholders: four groups on the overview, operators page lists published closures', async ({ page }) => {
  await fresh(page);
  for (const id of ['citizens', 'authorities', 'executors', 'operators']) await expect(page.getByTestId(`stakeholder-${id}`)).toBeVisible();
  await expect(page.getByTestId('primary-outcomes')).toContainText('إغلاقات أقل تكراراً');
  await page.getByTestId('stakeholder-operators').click();
  await expect(page.getByTestId('operators-page')).toContainText('إشعار مسبق');
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

test('language toggle switches UI chrome to English', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('lang-toggle').click();
  await expect(page.getByRole('link', { name: 'Conflict Analysis' })).toBeVisible();
});
