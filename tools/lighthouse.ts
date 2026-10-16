// npm run lighthouse — mobile Lighthouse audit of the built app, served by the
// real server on the "normal" replay (made-up data). Uses Playwright's Chromium.
// Lighthouse can't grant location, so it audits the first-visit screen.
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const port = 8795;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), GTFS_DIR: 'fixtures/gtfs', DATA_DIR: 'test-results/data-lh', REPLAY_FILE: 'fixtures/replay/normal.ndjson', FAKE_NOW: '2026-10-15T08:00:00-04:00', MBTA_API_KEY: '' },
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  mkdirSync(join(root, 'lighthouse'), { recursive: true });
  const out = join(root, 'lighthouse', 'report');
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    '--yes', 'lighthouse@12', `http://127.0.0.1:${port}/`,
    '--only-categories=performance,accessibility,best-practices',
    '--chrome-flags=--headless=new', '--output=json', '--output=html', `--output-path=${out}`, '--quiet',
  ], { cwd: root, env: { ...process.env, CHROME_PATH: chromium.executablePath() }, stdio: 'inherit', shell: process.platform === 'win32' });
  const r = JSON.parse(readFileSync(`${out}.report.json`, 'utf8'));
  for (const [k, c] of Object.entries(r.categories) as [string, { score: number }][]) console.log(`${k}: ${Math.round(c.score * 100)}`);
  for (const id of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'])
    console.log(`  ${id}: ${r.audits[id].displayValue}`);
  console.log(`Report: lighthouse/report.report.html`);
} finally {
  server.kill();
}
