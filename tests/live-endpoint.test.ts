// The browser's live feed: a snapshot, then only boards that changed.

import { afterEach, describe, expect, it } from 'vitest';
import type { LiveEvent } from '@twalk/core';
import { stack } from './helpers.ts';

const T0 = Date.parse('2026-10-15T08:00:00-04:00');

async function readEvents(url: string, until: (events: LiveEvent[]) => boolean, timeoutMs = 8000): Promise<LiveEvent[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, { signal: ac.signal });
  const events: LiveEvent[] = [];
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (data) events.push(JSON.parse(data.slice(6)) as LiveEvent);
      }
      if (until(events)) break;
    }
  } catch {
    // aborted
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return events;
}

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('/api/live', () => {
  it('sends a snapshot, then only the stops whose boards changed', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    await s.app.listen({ port: 0, host: '127.0.0.1' });
    close = () => s.app.close();
    const { port } = s.app.server.address() as { port: number };

    // While the client listens, the train at Park Street leaves (remove at 8:00:50).
    setTimeout(() => s.at(T0 + 52 * 1000), 300);
    const events = await readEvents(`http://127.0.0.1:${port}/api/live?stops=place-pktrm,B1,70075`, (ev) =>
      ev.some((e) => e.type === 'boards' && e.boards.some((b) => b.stopId === 'place-pktrm')),
    );

    const [snapshot, ...rest] = events;
    expect(snapshot?.type).toBe('snapshot');
    if (snapshot?.type !== 'snapshot') throw new Error('no snapshot');
    // A platform id is folded into its station, and not sent twice.
    expect(snapshot.boards.map((b) => b.stopId)).toEqual(['place-pktrm', 'B1']);
    expect(snapshot.routes.map((r) => r.id)).toContain('Red');

    const update = rest.find((e) => e.type === 'boards');
    if (update?.type !== 'boards') throw new Error('no update');
    const park = update.boards.find((b) => b.stopId === 'place-pktrm')!;
    expect(park.groups.find((g) => g.routeId === 'Red' && g.directionId === 0)?.rows[0]?.tripId).toBe('ADDED-2');
  });
});
