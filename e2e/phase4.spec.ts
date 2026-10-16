import { expect, test } from '@playwright/test';

// Alerts, commutes and offline mode on the "normal" replay with a stand-in OTP.
const HERE = { latitude: 42.3566, longitude: -71.0623 };

test.beforeEach(async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
});

test.describe('with location', () => {
  test.use({ geolocation: HERE, permissions: ['geolocation'] });

  test('shows a line alert on the stop it affects', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('twalk.location.optin.v1', 'true'));
    await page.goto('/');
    const park = page.getByRole('article', { name: 'Park Street' });
    await expect(park).toContainText('Delays');
    await expect(park).toContainText('disabled train at JFK/UMass');
    // The elevator outage is for step-free riders.
    await expect(park).not.toContainText('Elevator out');
  });

  test('keeps a timetable on the device and uses it offline, labelled', async ({ page, context }) => {
    await page.addInitScript(() => {
      localStorage.setItem('twalk.location.optin.v1', 'true');
      localStorage.setItem('twalk.pins.v1', JSON.stringify(['B1']));
    });
    await page.goto('/saved');
    await expect(page.getByRole('article', { name: 'Massachusetts Ave @ Tremont St' })).toContainText('Live');
    // The service worker has the app shell; the timetable pack is saved a few seconds after load.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(4500);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: "You're offline" })).toBeVisible();
    const card = page.getByRole('article', { name: 'Massachusetts Ave @ Tremont St' });
    await expect(card).toContainText('Scheduled');
    await expect(card).toContainText('8:19 AM');
    await expect(card.getByText('Live', { exact: true })).toHaveCount(0);
    await context.setOffline(false);
  });
});

test('saves a commute and shows when to leave', async ({ page }) => {
  await page.goto('/saved');
  await page.getByRole('button', { name: '+ Add a commute' }).click();
  const form = page.getByRole('region', { name: 'New commute' });
  await form.getByLabel('Name').fill('To class');
  await form.getByRole('combobox', { name: 'From' }).fill('park');
  await page.getByRole('option', { name: /^Park Street Station$/ }).click();
  await form.getByRole('combobox', { name: 'To' }).fill('harvard');
  await page.getByRole('option', { name: /Harvard Square/ }).click();
  await form.locator('input[type=time]').fill('08:45');
  await form.getByRole('button', { name: 'Save commute' }).click();
  const card = page.getByRole('article', { name: 'To class' });
  await expect(card).toContainText('Weekdays · arrive by 8:45 AM');
  await expect(card).toContainText(/Leave by \d+:\d\d AM/);
  await expect(card.getByRole('switch', { name: 'Leave-now notifications' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('article', { name: 'To class' })).toBeVisible();
});
