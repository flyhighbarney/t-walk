// What someone sees when you share your ETA: where you're going, when you
// expect to get there and how it's going. Never your location.

import { useEffect, useState } from 'react';
import { formatAge, formatClock, formatMinutes, type ShareView } from '@twalk/core';
import { getJson } from '../lib/api.ts';
import { useNow, usePageVisible } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';

export default function ShareScreen({ path }: { path: string }) {
  const id = path.split('/')[2]?.split('?')[0] ?? '';
  const visible = usePageVisible();
  const now = useNow();
  const [view, setView] = useState<ShareView | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'ended' | 'error'>('loading');

  useEffect(() => {
    // Fetch at once (even in a background tab), then keep checking only while it's visible.
    if (!id) return;
    let stop = false;
    let timer = 0;
    const tick = () => {
      // getJson keeps countdowns on the server's clock.
      getJson<ShareView>(`/api/share/${encodeURIComponent(id)}`)
        .then((v) => {
          if (stop) return;
          setView(v);
          setState('ok');
        })
        .catch((e: unknown) => {
          if (stop) return;
          if (String((e as Error).message).includes('404')) setState('ended');
          else setState((s) => (s === 'ok' ? s : 'error'));
        })
        .finally(() => {
          if (!stop && visible) timer = window.setTimeout(tick, 15_000);
        });
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [id, visible]);

  const quiet = view ? (now - view.updatedAt) / 1000 : 0;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <p className="text-brand-text text-sm font-bold">T-Walk · shared trip</p>
      {state === 'loading' ? <p className="text-muted">Loading…</p> : null}
      {state === 'ended' ? (
        <>
          <h1 className="text-3xl font-extrabold">This shared trip has ended</h1>
          <p className="text-muted">The person stopped sharing, arrived a while ago, or the link is more than 6 hours old.</p>
        </>
      ) : null}
      {state === 'error' ? <p className="bg-warn-bg text-warn-fg rounded-xl p-3">Couldn't load this right now. It will try again.</p> : null}
      {state === 'ok' && view ? (
        <section aria-live="polite" className="bg-surface shadow-float space-y-2 rounded-3xl p-6">
          <h1 className="text-xl font-bold">
            {view.name ? `${view.name} is` : "They're"} {view.arrived ? 'at' : 'on the way to'} {view.to}
          </h1>
          {view.arrived ? (
            <p className="text-brand-text text-4xl font-extrabold">Arrived</p>
          ) : (
            <>
              <p className="tabular text-5xl font-extrabold">{formatClock(view.eta).full}</p>
              <p className="text-muted">expected arrival{view.eta > now ? `, in about ${formatMinutes(Math.max(1, Math.round((view.eta - now) / 60_000))).text}` : ''}</p>
            </>
          )}
          {view.status ? <p className="bg-surface-2 rounded-xl p-3 font-semibold">{view.status}</p> : null}
          <p className={`text-sm ${quiet > 180 && !view.arrived ? 'text-warn-fg bg-warn-bg rounded-lg p-2' : 'text-muted'}`}>
            {quiet > 180 && !view.arrived ? `No update from their phone for ${formatAge(quiet).replace('updated ', '')}. The time may be out of date.` : formatAge(quiet).replace(/^u/, 'U')}
          </p>
        </section>
      ) : null}
      <p className="text-muted text-xs">Only the expected arrival and a short status are shared, never a location.</p>
      <button type="button" onClick={() => navigate('/')} className="text-brand-text self-start font-bold underline">
        Open T-Walk
      </button>
    </main>
  );
}
