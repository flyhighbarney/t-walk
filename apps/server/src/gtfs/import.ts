// Downloads the MBTA's GTFS feed when it has changed and imports it into a
// fresh SQLite file, which then replaces the current one in a single rename of
// a pointer file — a half-finished import is never what the server reads.

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse';
import yauzl from 'yauzl';
import { FILES, POST_IMPORT, SCHEMA } from './schema.ts';

export const GTFS_URL = 'https://cdn.mbta.com/MBTA_GTFS.zip';

interface Pointer {
  db: string;
  etag: string | null;
  lastModified: string | null;
  importedAt: string;
  feedVersion: string | null;
}

const pointerPath = (dataDir: string) => join(dataDir, 'gtfs-current.json');

export async function readPointer(dataDir: string): Promise<Pointer | null> {
  try {
    return JSON.parse(await readFile(pointerPath(dataDir), 'utf8')) as Pointer;
  } catch {
    return null;
  }
}

/** Path of the database the server should open, or null before the first import. */
export async function currentDbPath(dataDir: string): Promise<string | null> {
  const p = await readPointer(dataDir);
  return p && existsSync(join(dataDir, p.db)) ? join(dataDir, p.db) : null;
}

type Opener = (file: string) => Promise<Readable | null>;

function zipOpener(zipPath: string): Promise<{ open: Opener; close: () => void }> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: false, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'));
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (e: yauzl.Entry) => entries.set(e.fileName, e));
      zip.on('error', reject);
      zip.on('end', () =>
        resolve({
          open: (file) =>
            new Promise((res, rej) => {
              const entry = entries.get(file);
              if (!entry) return res(null);
              zip.openReadStream(entry, (e, s) => (e || !s ? rej(e) : res(s)));
            }),
          close: () => zip.close(),
        }),
      );
    });
  });
}

function dirOpener(dir: string): Opener {
  return async (file) => (existsSync(join(dir, file)) ? createReadStream(join(dir, file)) : null);
}

/** Import GTFS from a .zip file or a folder of .txt files into a new SQLite file. */
export async function importGtfs(source: string, dbPath: string, log: (msg: string) => void = () => {}): Promise<string | null> {
  const isZip = source.toLowerCase().endsWith('.zip');
  const zip = isZip ? await zipOpener(source) : null;
  const open = zip?.open ?? dirOpener(source);
  await rm(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY;');
    db.exec(SCHEMA);
    for (const spec of FILES) {
      const stream = await open(spec.file);
      if (!stream) {
        if (spec.required) throw new Error(`GTFS is missing ${spec.file}`);
        continue;
      }
      const started = Date.now();
      const insert = db.prepare(
        `INSERT OR REPLACE INTO ${spec.table} (${spec.columns.join(',')}) VALUES (${spec.columns.map(() => '?').join(',')})`,
      );
      let n = 0;
      db.exec('BEGIN');
      const parser = stream.pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: false }));
      for await (const row of parser) {
        insert.run(...spec.map(row as Record<string, string>));
        n++;
      }
      db.exec('COMMIT');
      log(`${spec.file}: ${n.toLocaleString('en-US')} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    const started = Date.now();
    db.exec(POST_IMPORT);
    log(`indexes in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'feed_version'`).get() as { value: string } | undefined;
    return version?.value ?? null;
  } finally {
    db.close();
    zip?.close();
  }
}

export interface RefreshResult {
  changed: boolean;
  dbPath: string | null;
  feedVersion: string | null;
}

/**
 * Check the MBTA feed (conditional request: a 304 costs nothing) and import it
 * if it changed or nothing has been imported yet.
 */
export async function refreshGtfs(opts: {
  dataDir: string;
  userAgent: string;
  url?: string;
  /** Import this folder or zip instead of downloading (tests, offline dev). */
  localSource?: string;
  log?: (msg: string) => void;
}): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  await mkdir(opts.dataDir, { recursive: true });
  const prev = await readPointer(opts.dataDir);
  const prevDb = prev ? join(opts.dataDir, prev.db) : null;

  let source = opts.localSource ?? null;
  let etag: string | null = null;
  let lastModified: string | null = null;

  if (!source) {
    const headers: Record<string, string> = { 'User-Agent': opts.userAgent };
    if (prev && prevDb && existsSync(prevDb)) {
      if (prev.etag) headers['If-None-Match'] = prev.etag;
      if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
    }
    const res = await fetch(opts.url ?? GTFS_URL, { headers });
    if (res.status === 304) return { changed: false, dbPath: prevDb, feedVersion: prev?.feedVersion ?? null };
    if (!res.ok || !res.body) throw new Error(`GTFS download failed: HTTP ${res.status}`);
    etag = res.headers.get('etag');
    lastModified = res.headers.get('last-modified');
    source = join(opts.dataDir, 'MBTA_GTFS.zip.part');
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(source));
    const zipPath = join(opts.dataDir, 'MBTA_GTFS.zip');
    await rename(source, zipPath);
    source = zipPath;
    log(`downloaded GTFS (${lastModified ?? 'no date'})`);
  }

  const name = `gtfs-${Date.now()}.sqlite`;
  const dbPath = join(opts.dataDir, name);
  const tmp = `${dbPath}.tmp`;
  const feedVersion = await importGtfs(source, tmp, log);
  await rename(tmp, dbPath);

  const pointer: Pointer = { db: name, etag, lastModified, importedAt: new Date().toISOString(), feedVersion };
  await writeFile(`${pointerPath(opts.dataDir)}.tmp`, JSON.stringify(pointer, null, 2));
  await rename(`${pointerPath(opts.dataDir)}.tmp`, pointerPath(opts.dataDir));
  log(`GTFS ${feedVersion ?? ''} ready: ${name}`);
  return { changed: true, dbPath, feedVersion };
}

/** Delete imported databases other than the current one (best effort; one may still be open). */
export async function pruneOldDatabases(dataDir: string, keep: string): Promise<void> {
  for (const f of await readdir(dataDir)) {
    if (/^gtfs-\d+\.sqlite(\.tmp)?$/.test(f) && join(dataDir, f) !== keep) {
      await rm(join(dataDir, f), { force: true }).catch(() => {});
    }
  }
}
