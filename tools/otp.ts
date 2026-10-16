// OpenTripPlanner, run directly with Java 25 (OTP 2.10 needs it).
//
//   npm run otp:fetch    download OTP, the OSM extracts and the GTFS feed into otp/data (checksummed)
//   npm run otp:build    build the street + transit graph (needs ~6 GB free memory, 10–20 min)
//   npm run otp:serve    serve it on http://127.0.0.1:8080 (GraphQL at /otp/gtfs/v1, debug UI at /)
//
// Configs live in otp/*.json (committed) and are copied next to the data before each run.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = join(import.meta.dirname, '..');
const OTP_DIR = join(ROOT, 'otp');
const DATA = join(OTP_DIR, 'data');
const OTP_VERSION = '2.10.0';
const JAR = `otp-shaded-${OTP_VERSION}.jar`;

const DOWNLOADS = [
  {
    file: JAR,
    url: `https://repo1.maven.org/maven2/org/opentripplanner/otp-shaded/${OTP_VERSION}/${JAR}`,
    checksum: { url: `https://repo1.maven.org/maven2/org/opentripplanner/otp-shaded/${OTP_VERSION}/${JAR}.sha1`, algo: 'sha1' },
  },
  {
    file: 'massachusetts.osm.pbf',
    url: 'https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf',
    checksum: { url: 'https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf.md5', algo: 'md5' },
  },
  {
    // Commuter Rail runs to Providence and Wickford Junction.
    file: 'rhode-island.osm.pbf',
    url: 'https://download.geofabrik.de/north-america/us/rhode-island-latest.osm.pbf',
    checksum: { url: 'https://download.geofabrik.de/north-america/us/rhode-island-latest.osm.pbf.md5', algo: 'md5' },
  },
  { file: 'mbta.gtfs.zip', url: 'https://cdn.mbta.com/MBTA_GTFS.zip', checksum: null },
];

async function hashFile(path: string, algo: string): Promise<string> {
  const h = createHash(algo);
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

async function fetchAll(force: boolean): Promise<void> {
  mkdirSync(DATA, { recursive: true });
  for (const d of DOWNLOADS) {
    const path = join(DATA, d.file);
    if (existsSync(path) && !force && d.file !== 'mbta.gtfs.zip') {
      console.log(`${d.file}: already here`);
      continue;
    }
    console.log(`${d.file}: downloading…`);
    const res = await fetch(d.url, { headers: { 'User-Agent': 't-walk-otp-setup' } });
    if (!res.ok || !res.body) throw new Error(`${d.url}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
    if (d.checksum) {
      const expected = (await (await fetch(d.checksum.url)).text()).trim().split(/\s+/)[0]!;
      const actual = await hashFile(path, d.checksum.algo);
      if (actual !== expected) throw new Error(`${d.file}: checksum mismatch (${actual} ≠ ${expected})`);
      console.log(`${d.file}: ${d.checksum.algo} OK`);
    }
  }
}

function findJava(): string {
  const candidates: string[] = [];
  if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\Eclipse Adoptium';
    if (existsSync(base)) for (const d of readdirSync(base).filter((n) => /^jdk-2[5-9]/.test(n)).sort().reverse()) candidates.push(join(base, d, 'bin', 'java.exe'));
  }
  candidates.push('java');
  for (const c of candidates) {
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' });
    const out = `${r.stderr ?? ''}${r.stdout ?? ''}`;
    const m = /version "(\d+)/.exec(out);
    if (m && Number(m[1]) >= 25) return c;
  }
  throw new Error('Java 25 or later not found. Install it (winget install EclipseAdoptium.Temurin.25.JDK) or set JAVA_HOME.');
}

function copyConfigs(): void {
  for (const f of ['build-config.json', 'router-config.json', 'otp-config.json']) {
    JSON.parse(readFileSync(join(OTP_DIR, f), 'utf8')); // fail early on a typo
    copyFileSync(join(OTP_DIR, f), join(DATA, f));
  }
}

function run(args: string[], heap: string): Promise<number> {
  const java = findJava();
  copyConfigs();
  const full = [`-Xmx${heap}`, '-jar', join(DATA, JAR), ...args, DATA];
  console.log(`${java} ${full.join(' ')}`);
  const child = spawn(java, full, { stdio: 'inherit', cwd: DATA });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

const [cmd, ...rest] = process.argv.slice(2);
const heapArg = rest.find((a) => a.startsWith('--heap='))?.slice(7);
if (cmd === 'fetch') await fetchAll(rest.includes('--force'));
else if (cmd === 'build') process.exitCode = await run(['--build', '--save'], heapArg ?? '7G');
else if (cmd === 'serve') process.exitCode = await run(['--load', '--port', process.env.OTP_PORT ?? '8080'], heapArg ?? '4G');
else {
  console.log('Usage: node tools/otp.ts fetch|build|serve [--heap=7G] [--force]');
  process.exitCode = 1;
}
