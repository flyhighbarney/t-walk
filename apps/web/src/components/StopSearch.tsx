import { useEffect, useId, useState } from 'react';
import type { StopSummary } from '@twalk/core';
import { searchStops } from '../lib/api.ts';

export function StopSearch({ onPick }: { onPick: (stop: StopSummary) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<StopSummary[]>([]);
  const [error, setError] = useState(false);
  const id = useId();

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      searchStops(q, ac.signal)
        .then((r) => {
          setResults(r.stops);
          setError(false);
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setError(true);
        });
    }, 200);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [q]);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        Find a stop or station
      </label>
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. Park Street, Harvard"
        autoComplete="off"
        className="bg-surface border-line w-full rounded-xl border px-3 py-3 text-base"
      />
      <div role="status" aria-live="polite" className="visually-hidden">
        {q.trim().length >= 2 ? `${results.length} stops found` : ''}
      </div>
      {error ? <p className="text-miss-text mt-2 text-sm">Couldn't search right now. Try again in a moment.</p> : null}
      {results.length > 0 ? (
        <ul className="bg-surface border-line divide-line mt-2 divide-y rounded-xl border">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(s);
                  setQ('');
                }}
                className="w-full px-3 py-3 text-left"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-muted block text-xs">{s.isStation ? 'Station' : 'Stop'} · {s.routeIds.length} routes</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
