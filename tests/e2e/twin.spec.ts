import { expect, test } from '@playwright/test';

test('3D prototype — excavation conflict scenario is fully interactive', async ({ page }) => {
  await page.goto('/twin');
  await expect(page.getByTestId('twin-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('twin-demo-data')).toHaveText('DEMO DATA / SIMULATED');
  await expect(page.getByTestId('twin-kit-status')).toContainText('بانتظار ملفات KitBash3D');
  await page.getByTestId('tw-start').click();
  await expect(page.getByTestId('m-exc')).toHaveText('0');
  await page.getByTestId('tw-exc-a').click();
  await expect(page.getByTestId('m-exc')).toHaveText('1');
  const congA = await page.getByTestId('m-cong').innerText();
  await page.getByTestId('tw-exc-b').click();
  await expect(page.getByTestId('m-exc')).toHaveText('2');
  await expect(page.getByTestId('tw-apply')).toBeDisabled();
  await page.getByTestId('tw-detect').click();
  await expect(page.getByTestId('m-conf')).toHaveText('1');
  await expect(page.getByTestId('tw-conflict-card')).toContainText('تعارض مسار التحويل');
  const congAB = Number((await page.getByTestId('m-cong').innerText()).replace('%', ''));
  expect(congAB).toBeGreaterThan(Number(congA.replace('%', '')));
  await page.getByTestId('tw-apply').click();
  await expect(page.getByTestId('m-conf')).toHaveText('0');
  await expect(page.getByTestId('tw-recommendation')).toContainText('طُبِّقت');
  expect(Number((await page.getByTestId('m-cong').innerText()).replace('%', ''))).toBeLessThan(congAB);
  await page.getByTestId('tw-compare').click();
  await expect(page.getByTestId('tw-compare-table')).toBeVisible();
  await page.getByTestId('tw-view-before').click();
  await expect(page.getByTestId('m-exc')).toHaveText('2');
  // camera + toggles respond
  for (const id of ['tw-cam-street', 'tw-cam-bridge', 'tw-cam-construction', 'tw-zoom-in', 'tw-rotate', 'tw-tg-traffic', 'tw-tg-routes', 'tw-reset-cam']) await page.getByTestId(id).click();
  const cam = await page.evaluate(() => (window as unknown as { __twin: { camera: { position: { y: number } } } }).__twin.camera.position.y);
  expect(cam).toBeGreaterThan(0);
  // history replay
  await page.getByTestId('tw-history-toggle').click();
  await page.getByTestId('tw-history-slider').fill('2');
  await expect(page.getByTestId('twin-status')).toContainText('السجل');
  await page.getByTestId('tw-reset').click();
  await expect(page.getByTestId('m-exc')).toHaveText('0');
});

test('3D prototype — guided demo walks to before/after and can be paused/skipped', async ({ page }) => {
  await page.goto('/twin');
  await page.getByTestId('tw-guided').click();
  await expect(page.getByTestId('tw-guided-title')).toHaveText('حركة طبيعية');
  await page.getByTestId('tw-guided-pause').click();
  for (let i = 0; i < 6; i++) await page.getByTestId('tw-guided-skip').click();
  await expect(page.getByTestId('tw-guided-title')).toHaveText('قبل / بعد');
  await expect(page.getByTestId('tw-compare-table')).toBeVisible();
  await expect(page.getByTestId('tw-recommendation')).toContainText('طُبِّقت');
  await page.getByTestId('tw-guided-restart').click();
  await expect(page.getByTestId('tw-guided-title')).toHaveText('حركة طبيعية');
});
