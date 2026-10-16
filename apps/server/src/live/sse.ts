// A minimal server-sent-events client over fetch, for the MBTA V3 stream.
//
// The MBTA's streaming page says the first event is always `reset` (the full
// current state) and that a reset can come again at any time; it gives no
// reconnection guidance and no event ids to resume from. So on every reconnect
// we simply wait for the next reset, and back off exponentially between tries.
// A watchdog reconnects a connection that has gone silent (a half-open TCP
// connection looks exactly like a quiet one otherwise).

import type { Clock } from './clock.ts';
import type { EventSink, StreamName } from './events.ts';

export interface SseOptions {
  stream: StreamName;
  url: string;
  headers: Record<string, string>;
  sink: EventSink;
  clock: Clock;
  /** Reconnect if no bytes arrive for this long. */
  silenceMs: number;
  log?: (msg: string) => void;
}

/** Parse SSE text incrementally. Returns the unconsumed tail. */
export function parseSseChunk(buffer: string, onEvent: (event: string, data: string) => void): string {
  let start = 0;
  for (;;) {
    // Events end with a blank line; accept \n\n and \r\n\r\n.
    const lf = buffer.indexOf('\n\n', start);
    const crlf = buffer.indexOf('\r\n\r\n', start);
    let end = -1;
    let sepLen = 0;
    if (lf !== -1 && (crlf === -1 || lf < crlf)) {
      end = lf;
      sepLen = 2;
    } else if (crlf !== -1) {
      end = crlf;
      sepLen = 4;
    }
    if (end === -1) return buffer.slice(start);
    const block = buffer.slice(start, end);
    start = end + sepLen;
    let event = 'message';
    const data: string[] = [];
    for (const raw of block.split(/\r?\n/)) {
      if (raw === '' || raw.startsWith(':')) continue; // comment / keep-alive
      const colon = raw.indexOf(':');
      const field = colon === -1 ? raw : raw.slice(0, colon);
      let value = colon === -1 ? '' : raw.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) onEvent(event, data.join('\n'));
  }
}

export class SseStream {
  private abort: AbortController | null = null;
  private stopped = false;
  private attempt = 0;
  private watchdog: NodeJS.Timeout | null = null;
  private lastByteAt = 0;
  connected = false;
  private readonly opts: SseOptions;

  constructor(opts: SseOptions) {
    this.opts = opts;
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    if (this.watchdog) clearInterval(this.watchdog);
  }

  private async loop(): Promise<void> {
    const { opts } = this;
    while (!this.stopped) {
      this.abort = new AbortController();
      let reason = 'ended';
      try {
        const res = await fetch(opts.url, {
          headers: { Accept: 'text/event-stream', ...opts.headers },
          signal: this.abort.signal,
        });
        if (!res.ok || !res.body) {
          reason = `HTTP ${res.status}`;
          if (res.status === 401 || res.status === 403) reason += ' (check MBTA_API_KEY)';
          if (res.status === 429) reason += ' (rate limited)';
          throw new Error(reason);
        }
        this.connected = true;
        this.attempt = 0;
        this.lastByteAt = Date.now();
        opts.sink({ t: opts.clock.now(), stream: opts.stream, kind: 'open' });
        this.armWatchdog();
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          this.lastByteAt = Date.now();
          buffer += decoder.decode(chunk, { stream: true });
          buffer = parseSseChunk(buffer, (event, data) =>
            opts.sink({ t: opts.clock.now(), stream: opts.stream, kind: 'message', event, data }),
          );
        }
      } catch (err) {
        if (this.stopped) return;
        reason = this.abort.signal.aborted ? 'silent too long' : (err as Error).message || reason;
      } finally {
        if (this.watchdog) clearInterval(this.watchdog);
      }
      if (this.connected) {
        this.connected = false;
        opts.sink({ t: opts.clock.now(), stream: opts.stream, kind: 'close', reason });
      }
      if (this.stopped) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
      this.attempt = Math.min(this.attempt + 1, 6);
      opts.log?.(`${opts.stream}: ${reason}; reconnecting in ${(delay / 1000).toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private armWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastByteAt > this.opts.silenceMs) this.abort?.abort();
    }, 5_000);
    this.watchdog.unref();
  }
}
