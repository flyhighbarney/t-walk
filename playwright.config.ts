import { defineConfig, devices } from '@playwright/test';

// E2E_PORT moves all three servers (normal, outage, stand-in OTP) when 8790-8792 are taken.
const PORT = Number(process.env.E2E_PORT ?? 8790);

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
    OTP_URL: `http://127.0.0.1:${PORT + 2}`,
    PHOTON_URL: `http://127.0.0.1:${PORT + 2}/api/`,
  },
});

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },
  webServer: [
    { command: `node tools/fake-otp.ts ${PORT + 2}`, port: PORT + 2, reuseExistingServer: false, timeout: 20_000 },
    server(PORT, 'normal', '2026-10-15T08:00:00-04:00'),
    server(PORT + 1, 'outage', '2026-10-15T08:05:00-04:00'),
  ],
});
