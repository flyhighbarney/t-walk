// Environment → settings. Secrets come only from the environment (.env).

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  mbtaApiKey: string | null;
  userAgent: string;
  gtfsDir: string | null;
  replayFile: string | null;
  fakeNow: number | null;
  /** Record upstream events to this folder (NDJSON per hour). */
  recordDir: string | null;
  /** Serve the built web app from here, if it exists. */
  webDist: string;
  /** OpenTripPlanner's base URL. */
  otpUrl: string;
  /** Photon's search endpoint (a stand-in in tests). */
  photonUrl: string;
}

const fromRoot = (p: string) => resolve(REPO_ROOT, p);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fakeNow = env.FAKE_NOW ? Date.parse(env.FAKE_NOW) : null;
  if (fakeNow != null && Number.isNaN(fakeNow)) throw new Error(`FAKE_NOW is not a date: ${env.FAKE_NOW}`);
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    dataDir: fromRoot(env.DATA_DIR ?? 'data'),
    mbtaApiKey: env.MBTA_API_KEY?.trim() || null,
    userAgent: `t-walk/0.1 ${env.CONTACT ?? '(no contact set)'}`,
    gtfsDir: env.GTFS_DIR ? fromRoot(env.GTFS_DIR) : null,
    replayFile: env.REPLAY_FILE ? fromRoot(env.REPLAY_FILE) : null,
    fakeNow,
    recordDir: env.RECORD_DIR ? fromRoot(env.RECORD_DIR) : null,
    webDist: fromRoot(env.WEB_DIST ?? 'apps/web/dist'),
    otpUrl: (env.OTP_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    photonUrl: env.PHOTON_URL ?? 'https://photon.komoot.io/api/',
  };
}
