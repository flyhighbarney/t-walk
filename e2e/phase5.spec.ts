import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Navigation and shared ETAs, on the stand-in OpenTripPlanner and the "normal" replay.
test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
});

const PLAN = '/trips?from=42.35640,-71.06240&fromName=Park%20Street&to=42.37320,-71.11890&toName=Harvard%20Yard';

test('a plan lives in the URL: refresh keeps it, Back closes the open trip', async ({ page }) => {
  await page.goto(PLAN);
  const cards = page.getByRole('region', { name: 'Trips' }).getByRole('button');
  await expect(cards).toHaveCount(2);
  await cards.nth(1).click();
  await expect(page).toHaveURL(/open=/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/open=/);
  await expect(cards).toHaveCount(2);
});

test('Start navigates: walk, board, ride, with a shareable ETA', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  // Standing at the walk's end, Park Street: the walk is done at once.
  await context.setGeolocation({ latitude: 42.356395, longitude: -71.062424, accuracy: 5 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('twalk.location.optin.v1', 'true'));
  await page.goto(PLAN);
  await page.getByRole('region', { name: 'Trips' }).getByRole('button').nth(1).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/go$/);
  const banner = page.getByRole('banner');
  await expect(banner).toContainText('Board the Red Line');
  await expect(banner).toContainText('get off at South Station');

  await page.getByRole('button', { name: "I'm on board" }).click();
  await expect(banner).toContainText(/Get off in \d stops?|Your stop is next|Ride to South Station/);

  // Share: the link shows the ETA and status, never a location.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => ((window as unknown as { copied: string }).copied = t) }, configurable: true });
  });
  await page.getByRole('button', { name: 'Share ETA' }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing' })).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { copied: string }).copied.match(/http\S+/)![0]);
  const viewer = await context.newPage();
  await viewer.goto(link);
  await expect(viewer.getByRole('heading', { level: 1 })).toContainText('on the way to Harvard Yard');
  await expect(viewer.getByText(/On the Red Line/)).toBeVisible();

  // Leaving and coming back resumes the trip.
  await page.goto('/trips');
  await page.getByRole('button', { name: /Trip in progress/ }).click();
  await expect(banner).toContainText(/Get off|Your stop|Ride to/);

  await page.getByRole('button', { name: 'End' }).click();
  await expect(page).toHaveURL(/\/trips/);
  await viewer.reload();
  await expect(viewer.getByRole('heading', { level: 1 })).toContainText('This shared trip has ended');
});

test('Back closes a map sheet instead of leaving the map', async ({ page }) => {
  await page.goto('/');
  await page.goto('/map');
  await page.getByRole('button', { name: 'Map layers' }).click();
  await expect(page).toHaveURL(/sheet=layers/);
  await page.goBack();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole('button', { name: 'Map layers' })).toBeVisible();
});

test('the navigation screen has no axe accessibility violations', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 42.358, longitude: -71.064, accuracy: 5 });
  await page.goto(PLAN);
  await page.getByRole('region', { name: 'Trips' }).getByRole('button').nth(1).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('region', { name: 'Trip progress' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('.maplibregl-canvas').analyze();
  expect(results.violations).toEqual([]);
});
