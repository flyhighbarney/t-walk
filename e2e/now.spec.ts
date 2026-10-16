import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Standing on Tremont St, next to Park Street and the B1 bus stop (fixtures/gtfs).
const HERE = { latitude: 42.3566, longitude: -71.0623 };

test.describe('with location', () => {
  test.use({ geolocation: HERE, permissions: ['geolocation'] });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('twalk.location.optin.v1', 'true'));
  });

  test('lists nearby stops by walking time with labelled live times', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Near you, by walking time' })).toBeVisible();
    const cards = page.getByRole('article');
    await expect(cards.first().getByRole('heading', { level: 2 })).toHaveText('Massachusetts Ave @ Tremont St');

    const park = page.getByRole('article', { name: 'Park Street' });
    await expect(park).toContainText('Red Line');
    await expect(park).toContainText('Boarding');
    await expect(park).toContainText('Live');
    await expect(park).toContainText('via Tremont St');

    const bus = page.getByRole('article', { name: 'Massachusetts Ave @ Tremont St' });
    await expect(bus).toContainText('Estimate'); // uncertainty 300, not "Live"
    await expect(bus).toContainText('Scheduled');
    await expect(bus).toContainText('8:34 AM'); // schedules are clock times, never countdowns
    // "Can I make it" always pairs the colour with a word.
    await expect(bus.getByText(/You have time|Hurry|You'll miss it/).first()).toBeVisible();

    const sstat = page.getByRole('article', { name: 'South Station' });
    await expect(sstat).toContainText('8:20 AM');
    await expect(sstat).toContainText('Track 3');
  });

  test('screen-reader text says what kind of time each row is', async ({ page }) => {
    await page.goto('/');
    const bus = page.getByRole('article', { name: 'Massachusetts Ave @ Tremont St' });
    await expect(bus.getByText(/Harvard, in about 1\d minutes, estimate from the schedule, not live/)).toBeAttached();
  });

  test('pins a stop and keeps it after a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pin South Station' }).click();
    await expect(page.getByRole('heading', { name: 'Your stops' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Unpin South Station' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('has no axe accessibility violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('article', { name: 'Park Street' })).toContainText('Boarding');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const found = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 120)} — ${n.failureSummary}`));
    expect(found).toEqual([]);
  });
});

test.describe('without location', () => {
  test('explains location use and offers search instead', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "See what's leaving near you" })).toBeVisible();
    await expect(page.getByText('only while the app is open')).toBeVisible();
    await page.getByLabel('Find a stop or station').fill('park');
    await page.getByRole('button', { name: /Park Street/ }).click();
    await expect(page.getByRole('article', { name: 'Park Street' })).toContainText('Red Line');
  });
});

test.describe('stream outage', () => {
  test.use({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 8790) + 1}`, geolocation: HERE, permissions: ['geolocation'] });

  test('says live data is unavailable and shows the schedule, labelled', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('twalk.location.optin.v1', 'true'));
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: 'Live arrival data is unavailable' })).toBeVisible();
    const bus = page.getByRole('article', { name: 'Massachusetts Ave @ Tremont St' });
    await expect(bus).toContainText('Live times unavailable: showing the schedule');
    await expect(bus).toContainText('8:19 AM');
    // No row is labelled live while the data is down.
    await expect(bus.getByText('Live', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'Park Street' })).toContainText(/Every \d+–\d+ min/);
  });
});
