import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The basemap comes from OpenFreeMap; these tests block it so they run
// offline, which also checks that the transit layers draw without it.
test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
});

test('opens the map from the tab bar and shows live status', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Map' }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('status').filter({ hasText: /Live/ })).toBeVisible({ timeout: 15_000 });
  for (const chip of ['Subway', 'Bus', 'Commuter Rail', 'Ferry', 'Bluebikes']) {
    await expect(page.getByRole('button', { name: chip })).toBeVisible();
  }
});

test('lists what is in view, and opens a vehicle with its next stops', async ({ page }) => {
  await page.goto('/map');
  await expect(page.getByRole('status').filter({ hasText: /Live/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: "List what's in view" }).click();
  const list = page.getByRole('dialog', { name: 'In view' });
  await expect(list.getByRole('button', { name: 'Park Street', exact: true })).toBeVisible();
  await list.getByRole('button', { name: /^Red to/ }).first().click();
  const sheet = page.getByRole('dialog', { name: /to / });
  await expect(sheet).toContainText('Live position');
  await expect(sheet.getByRole('listitem').first()).toContainText('Park Street');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('opens a stop on the map from "Show on map"', async ({ page }) => {
  await page.goto('/map?stop=place-pktrm');
  const sheet = page.getByRole('dialog', { name: 'Park Street' });
  await expect(sheet).toContainText('Red Line');
  await expect(sheet).toContainText('Live');
});

test('turns layers on and off, and remembers them', async ({ page }) => {
  await page.goto('/map');
  await page.getByRole('button', { name: 'Map layers' }).click();
  const bikes = page.getByRole('switch', { name: /Bluebikes stations/ });
  await expect(bikes).not.toBeChecked();
  await bikes.check({ force: true });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Bluebikes' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Bluebikes' })).toHaveAttribute('aria-pressed', 'true');
});

test('the map screen has no axe accessibility violations', async ({ page }) => {
  await page.goto('/map');
  await expect(page.getByRole('status').filter({ hasText: /Live/ })).toBeVisible({ timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The map canvas itself is drawn by MapLibre; its alternative is the In view list.
    .exclude('.maplibregl-canvas-container')
    .analyze();
  const found = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 120)} — ${n.failureSummary}`));
  expect(found).toEqual([]);
});
