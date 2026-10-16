// Renders the PNG app icons from apps/web/public/icon.svg (node tools/make-icons.ts).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const pub = join(import.meta.dirname, '../apps/web/public');
const svg = readFileSync(join(pub, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function shot(file: string, size: number, opts: { fullBleed?: boolean; inset?: number } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inset = opts.inset ?? 0;
  const inner = opts.fullBleed ? svg.replace('rx="112"', 'rx="0"') : svg;
  await page.setContent(`<html><body style="margin:0;background:${opts.fullBleed ? '#0a0a0a' : 'transparent'}">
    <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
    <div style="width:${size - 2 * inset}px;height:${size - 2 * inset}px">${inner.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`);
  await page.screenshot({ path: join(pub, file), omitBackground: !opts.fullBleed });
}
await shot('icon-192.png', 192);
await shot('icon-512.png', 512);
await shot('icon-maskable-512.png', 512, { fullBleed: true, inset: 51 });
await shot('apple-touch-icon.png', 180, { fullBleed: true });
await browser.close();
console.log('icons written');
