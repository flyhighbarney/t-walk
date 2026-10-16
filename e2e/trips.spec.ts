import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Plans against a stand-in OpenTripPlanner (tools/fake-otp.ts) on the "normal" replay.
test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
});

async function planParkToHarvard(page: import('@playwright/test').Page) {
  await page.goto('/trips');
  await page.getByRole('combobox', { name: 'From' }).fill('park');
  await page.getByRole('option', { name: /^Park Street Station$/ }).click();
  await page.getByRole('combobox', { name: 'To' }).fill('harvard');
  await page.getByRole('option', { name: /Harvard Square/ }).click();
}

test('plans a trip and shows labelled, sortable results', async ({ page }) => {
  await planParkToHarvard(page);
  const trips = page.getByRole('region', { name: 'Trips' });
  const cards = trips.getByRole('button');
  await expect(cards).toHaveCount(2);
  // Fastest first: walking all the way.
  await expect(cards.first()).toContainText('Walk it');
  const transit = cards.nth(1);
  await expect(transit).toContainText('1 transfer');
  await expect(transit).toContainText('$2.40');
  await expect(transit).toContainText('Tight transfer');
  await expect(transit).toContainText('Scheduled');
  await page.getByRole('button', { name: 'Least walking' }).click();
  await expect(cards.first()).toContainText('1 transfer');
});

test('opens a trip with its steps, risk, and "What if I miss it?"', async ({ page }) => {
  await planParkToHarvard(page);
  await page.getByRole('region', { name: 'Trips' }).getByRole('button').nth(1).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Trip');
  const steps = page.getByRole('list', { name: 'Steps' });
  await expect(steps).toContainText('Board at Park Street');
  await expect(steps).toContainText('Estimate'); // the bus: schedule-based, not live
  await expect(steps).toContainText('Red Line: expect minor delays');
  // In the summary at the top, and again at the walk it's about.
  await expect(page.getByText(/Tight transfer: 3 min to spare after a 2 min walk/)).toHaveCount(2);
  await steps.getByRole('button', { name: 'Directions' }).first().click();
  await expect(steps).toContainText('Turn left on Park Street');
  await steps.getByRole('button', { name: 'What if I miss it?' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /Next way from Park Street/ })).toBeVisible();
});

test('step-free mode is a switch that sticks', async ({ page }) => {
  await page.goto('/trips');
  const sw = page.getByRole('switch', { name: /Step-free/ });
  await sw.check({ force: true });
  await page.reload();
  await expect(page.getByRole('switch', { name: /Step-free/ })).toBeChecked();
});

test('the Trips screen has no axe accessibility violations', async ({ page }) => {
  await planParkToHarvard(page);
  await expect(page.getByRole('region', { name: 'Trips' }).getByRole('button')).toHaveCount(2);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const found = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 120)} — ${n.failureSummary}`));
  expect(found).toEqual([]);
});
