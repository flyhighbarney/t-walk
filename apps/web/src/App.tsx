// The "Now" screen: departures near you, sorted by how long it takes to walk
// to each stop, plus the stops you've pinned.

import { useEffect, useMemo, useState } from 'react';
import {
  STATION_ENTRY_SECONDS,
  estimateWalk,
  haversineMeters,
  type NearbyResponse,
  type StopResponse,
  type StopSummary,
  type WalkEstimate,
  type WalkPace,
} from '@twalk/core';
import { StatusBanner } from './components/StatusBanner.tsx';
import { StopCard } from './components/StopCard.tsx';
import { StopSearch } from './components/StopSearch.tsx';
import { fetchNearby, fetchStop } from './lib/api.ts';
import { useLiveBoards, useNow } from './lib/live.ts';
import { useLocation } from './lib/location.ts';
import { useLocationOptIn, usePinnedStops, useWalkPace } from './lib/storage.ts';

const PACES: { value: WalkPace; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
];

function PacePicker({ pace, onChange }: { pace: WalkPace; onChange: (p: WalkPace) => void }) {
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="visually-hidden">Walking pace</legend>
      <span className="text-muted text-sm" aria-hidden>
        Pace
      </span>
      <div className="bg-surface-2 flex rounded-full p-1">
        {PACES.map((p) => (
          <label key={p.value} className="relative">
            <input
              type="radio"
              name="pace"
              value={p.value}
              checked={pace === p.value}
              onChange={() => onChange(p.value)}
              className="peer absolute inset-0 cursor-pointer opacity-0"
            />
            <span className="peer-checked:bg-surface peer-checked:text-text text-muted peer-focus-visible:outline-focus flex min-h-9 items-center rounded-full px-3 text-sm font-medium peer-checked:shadow-sm peer-focus-visible:outline-3">
              {p.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LocationIntro({ onAllow }: { onAllow: () => void }) {
  return (
    <section aria-labelledby="loc-h" className="bg-surface border-line rounded-2xl border p-4">
      <h2 id="loc-h" className="text-lg font-bold">
        See what's leaving near you
      </h2>
      <p className="mt-1 text-sm">
        T-Walk uses your location only while the app is open, to find nearby stops and estimate your walk. It is sent to the
        T-Walk server for that lookup and is not stored.
      </p>
      <button type="button" onClick={onAllow} className="mt-3 min-h-11 rounded-xl bg-[#1b3a5c] px-4 font-semibold text-white">
        Use my location
      </button>
      <p className="text-muted mt-3 text-sm">Or search for a stop instead:</p>
    </section>
  );
}

export default function App() {
  const [optIn, setOptIn] = useLocationOptIn();
  const location = useLocation(optIn);
  const [pins, togglePin] = usePinnedStops();
  const [pace, setPace] = useWalkPace();
  const [nearby, setNearby] = useState<NearbyResponse | null>(null);
  const [nearbyError, setNearbyError] = useState(false);
  const [extra, setExtra] = useState<Map<string, StopResponse>>(new Map());
  const [picked, setPicked] = useState<string[]>([]);
  const now = useNow();

  const lat = location.kind === 'ok' ? location.lat : null;
  const lon = location.kind === 'ok' ? location.lon : null;

  useEffect(() => {
    if (lat == null || lon == null) return;
    const ac = new AbortController();
    fetchNearby(lat, lon, pace, ac.signal)
      .then((r) => {
        setNearby(r);
        setNearbyError(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setNearbyError(true);
      });
    return () => ac.abort();
  }, [lat, lon, pace]);

  // Pinned and searched-for stops that aren't in the nearby list.
  const nearbyIds = useMemo(() => new Set(nearby?.stops.map((s) => s.id) ?? []), [nearby]);
  const wanted = useMemo(() => [...new Set([...pins, ...picked])].filter((id) => !nearbyIds.has(id)), [pins, picked, nearbyIds]);
  useEffect(() => {
    const missing = wanted.filter((id) => !extra.has(id));
    if (missing.length === 0) return;
    const ac = new AbortController();
    Promise.all(missing.map((id) => fetchStop(id, ac.signal).catch(() => null))).then((rs) => {
      setExtra((prev) => {
        const next = new Map(prev);
        for (const r of rs) if (r) next.set(r.stop.id, r);
        return next;
      });
    });
    return () => ac.abort();
  }, [wanted, extra]);

  const liveIds = useMemo(() => [...nearbyIds, ...wanted], [nearbyIds, wanted]);
  const seed = useMemo(() => {
    const extras = [...extra.values()];
    if (!nearby && extras.length === 0) return undefined;
    return {
      boards: [...(nearby?.boards ?? []), ...extras.map((e) => e.board)],
      routes: [...(nearby?.routes ?? []), ...extras.flatMap((e) => e.routes)],
      status: nearby?.status ?? extras[0]!.status,
    };
  }, [nearby, extra]);
  const live = useLiveBoards(liveIds, seed);
  const status = live.status ?? seed?.status ?? null;

  const walkTo = (stop: StopSummary): WalkEstimate | null =>
    lat == null || lon == null
      ? null
      : estimateWalk(haversineMeters(lat, lon, stop.latitude, stop.longitude), pace, stop.isStation ? STATION_ENTRY_SECONDS : 0);

  const card = (stop: StopSummary, walk: WalkEstimate | null, entranceName: string | null) => (
    <StopCard
      key={stop.id}
      stop={stop}
      walk={walk}
      entranceName={entranceName}
      board={live.boards.get(stop.id)}
      routes={live.routes}
      status={status}
      now={now}
      pinned={pins.includes(stop.id)}
      onTogglePin={togglePin}
    />
  );

  const pinnedStops = pins
    .map((id) => nearby?.stops.find((s) => s.id === id) ?? extra.get(id)?.stop)
    .filter((s): s is StopSummary => s != null);
  const pickedStops = picked
    .filter((id) => !pins.includes(id))
    .map((id) => extra.get(id)?.stop ?? nearby?.stops.find((s) => s.id === id))
    .filter((s): s is StopSummary => s != null);
  const nearbyStops = (nearby?.stops ?? []).filter((s) => !pins.includes(s.id));

  return (
    <main className="mx-auto max-w-xl px-4 pt-4 pb-10">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">T-Walk</h1>
        <PacePicker pace={pace} onChange={setPace} />
      </header>

      <div className="space-y-4">
        <StatusBanner status={status} connection={live.connection} lastMessageAt={live.lastMessageAt} />

        {!optIn ? <LocationIntro onAllow={() => setOptIn(true)} /> : null}
        {location.kind === 'denied' ? (
          <p className="bg-warn-bg text-warn-fg rounded-xl px-3 py-2 text-sm">
            Location is turned off for this site. Turn it on in your browser's settings, or search for a stop.
          </p>
        ) : null}
        {location.kind === 'unavailable' ? <p className="bg-warn-bg text-warn-fg rounded-xl px-3 py-2 text-sm">{location.message}</p> : null}
        {!optIn || location.kind === 'denied' || location.kind === 'unavailable' ? (
          <StopSearch onPick={(s) => setPicked((p) => (p.includes(s.id) ? p : [s.id, ...p]))} />
        ) : null}

        {pickedStops.length > 0 ? <div className="space-y-3">{pickedStops.map((s) => card(s, walkTo(s), null))}</div> : null}

        {pinnedStops.length > 0 ? (
          <section aria-labelledby="pins-h" className="space-y-3">
            <h2 id="pins-h" className="text-muted text-sm font-semibold tracking-wide uppercase">
              Your stops
            </h2>
            {pinnedStops.map((s) => {
              const n = nearby?.stops.find((x) => x.id === s.id);
              return card(s, n?.walk ?? walkTo(s), n?.entranceName ?? null);
            })}
          </section>
        ) : null}

        {optIn && location.kind === 'locating' && !nearby ? <p className="text-muted">Finding your location…</p> : null}
        {nearbyError ? <p className="text-miss-fg text-sm">Couldn't load nearby stops. Check your connection; T-Walk will keep trying.</p> : null}

        {nearbyStops.length > 0 ? (
          <section aria-labelledby="near-h" className="space-y-3">
            <h2 id="near-h" className="text-muted text-sm font-semibold tracking-wide uppercase">
              Near you, by walking time
            </h2>
            {nearbyStops.map((s) => card(s, s.walk, s.entranceName))}
          </section>
        ) : null}
        {nearby && nearby.stops.length === 0 ? <p className="text-muted">No stops with service within a 10-minute walk.</p> : null}
      </div>

      <footer className="text-muted mt-8 space-y-1 text-xs">
        <p>Walking times are estimates from straight-line distance. "Live" times are MBTA predictions; "Scheduled" times are not live.</p>
        <p>Data from the MBTA (MassDOT Developers License). T-Walk is not affiliated with the MBTA.</p>
      </footer>
    </main>
  );
}
