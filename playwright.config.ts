import { defineConfig, devices } from '@playwright/test';

// Two servers on recorded scenarios (made-up data, fixed clock): normal service
// and a stream outage. Each serves the built web app (npm run build first).
const server = (port: number, scenario: string, fakeNow: string) => ({
  command: 'node --disable-warning=ExperimentalWarning apps/server/src/main.ts',
  port,
  reuseExistingServer: false,
  timeout: 60_000,
  env: {
    PORT: String(port),
    HOST: '127.0.0.1',
    GTFS_DIR: 'fixtures/gtfs',
    DATA_DIR: `test-results/data-${scenario}`,
    REPLAY_FILE: `fixtures/replay/${scenario}.ndjson`,
    FAKE_NOW: fakeNow,
    MBTA_API_KEY: '',
    // A stand-in OpenTripPlanner and Photon (tools/fake-otp.ts).
    OTP_URL: 'http://127.0.0.1:8792',
    PHOTON_URL: 'http://127.0.0.1:8792/api/',
  },
});

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:8790',
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },
  webServer: [
    { command: 'node tools/fake-otp.ts 8792', port: 8792, reuseExistingServer: false, timeout: 20_000 },
    server(8790, 'normal', '2026-10-15T08:00:00-04:00'),
    server(8791, 'outage', '2026-10-15T08:05:00-04:00'),
  ],
});
