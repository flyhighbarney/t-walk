// Writes every upstream event to disk as NDJSON, one file per hour, so a real
// morning can be replayed later (tools/replay). GTFS-RT polls are large
// (~500 KB each), so they're kept only once a minute unless asked otherwise.

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { localDate } from '@twalk/core';
import type { UpstreamEvent } from './events.ts';

export class Recorder {
  private file: WriteStream | null = null;
  private fileKey = '';
  private lastFeedAt = new Map<string, number>();
  private readonly dir: string;
  private readonly feedEveryMs: number;

  constructor(dir: string, opts: { feedEveryMs?: number } = {}) {
    this.dir = dir;
    this.feedEveryMs = opts.feedEveryMs ?? 60_000;
    mkdirSync(dir, { recursive: true });
  }

  write(e: UpstreamEvent): void {
    if (e.kind === 'message' && e.stream.startsWith('gtfsrt-')) {
      const last = this.lastFeedAt.get(e.stream) ?? 0;
      if (e.t - last < this.feedEveryMs) return;
      this.lastFeedAt.set(e.stream, e.t);
    }
    const hour = new Date(e.t).toISOString().slice(11, 13);
    const key = `${localDate(e.t)}-${hour}Z`;
    if (key !== this.fileKey) {
      this.file?.end();
      this.file = createWriteStream(join(this.dir, `${key}.ndjson`), { flags: 'a' });
      this.fileKey = key;
    }
    this.file!.write(`${JSON.stringify(e)}\n`);
  }

  close(): void {
    this.file?.end();
  }
}
