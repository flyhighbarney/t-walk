// Server-sent events to the browser, gzipped when the browser accepts it.
// Each event is flushed through the compressor straight away (Z_SYNC_FLUSH),
// so compression saves data (vehicle updates shrink ~6×) without delaying anything.

import { constants, createGzip, type Gzip } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SseChannel {
  send(event: string, data: unknown): void;
  onClose(fn: () => void): void;
}

export function openSse(req: FastifyRequest, reply: FastifyReply): SseChannel {
  reply.hijack();
  const res = reply.raw;
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
  });
  let z: Gzip | null = null;
  if (gzip) {
    z = createGzip({ flush: constants.Z_SYNC_FLUSH });
    z.pipe(res);
  }
  const closers: (() => void)[] = [];
  req.raw.on('close', () => {
    z?.end();
    for (const fn of closers) fn();
  });
  return {
    send(event, data) {
      const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      if (z) z.write(chunk);
      else res.write(chunk);
    },
    onClose(fn) {
      closers.push(fn);
    },
  };
}
