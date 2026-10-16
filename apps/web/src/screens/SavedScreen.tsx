// Saved: commutes, the stops you've pinned with live departures, and your walking pace.

import { useEffect, useMemo, useState } from 'react';
import { STATION_ENTRY_SECONDS, estimateWalk, haversineMeters, type StopResponse } from '@twalk/core';
import { AppHeader } from '../components/Shell.tsx';
import { StatusBanner } from '../components/StatusBanner.tsx';
import { StopCard } from '../components/StopCard.tsx';
import { StarIcon } from '../components/icons.tsx';
import { fetchStop } from '../lib/api.ts';
import { useLiveBoards, useNow } from '../lib/live.ts';
import { useLocation } from '../lib/location.ts';
import { useLocationOptIn, usePinnedStops, useStepFree, useWalkPace } from '../lib/storage.ts';
import { useStopAlerts } from '../components/Alerts.tsx';
import { CommutesSection } from './commutes/Commutes.tsx';
import { PaceSection } from './PaceSection.tsx';
import { useKeepOffline, useOfflineBoards, useOnline, usePack } from '../lib/offline.ts';

export default function SavedScreen() {
  const [pins, togglePin] = usePinnedStops();
  const [optIn] = useLocationOptIn();
  const location = useLocation(optIn);
  const [pace] = useWalkPace();
  const [stops, setStops] = useState<Map<string, StopResponse>>(new Map());
  const now = useNow();

  useEffect(() => {
    const missing = pins.filter((id) => !stops.has(id));
    if (missing.length === 0) return;
    const ac = new AbortController();
    Promise.all(missing.map((id) => fetchStop(id, ac.signal).catch(() => null))).then((rs) =>
      setStops((prev) => {
        const next = new Map(prev);
        for (const r of rs) if (r) next.set(r.stop.id, r);
        return next;
      }),
    );
    return () => ac.abort();
  }, [pins, stops]);

  const seed = useMemo(() => {
    const list = [...stops.values()];
    return list.length ? { boards: list.map((s) => s.board), routes: list.flatMap((s) => s.routes), status: list[0]!.status } : undefined;
  }, [stops]);
  const live = useLiveBoards(pins, seed);
  const [stepFree] = useStepFree();
  const alerts = useStopAlerts(pins, stepFree);
  const online = useOnline();
  const offline = !online;
  const pack = usePack();
  useKeepOffline(online ? pins : []);
  const offlineBoards = useOfflineBoards(pins, offline);

  return (
    <>
      <AppHeader title="Saved" />
      <main className="pb-tabbar mx-auto max-w-xl space-y-4 px-4 pt-2">
        <StatusBanner status={live.status} connection={live.connection} lastMessageAt={live.lastMessageAt} offline={offline ? { savedAt: pack?.generatedAt ?? null } : null} />
        <CommutesSection />
        <h2 className="font-serif text-lg font-bold">Saved stops</h2>
        {pins.length === 0 ? (
          <div className="bg-surface rounded-xl p-5 text-center">
            <StarIcon filled={false} className="text-star mx-auto mb-2 size-8" />
            <h2 className="font-serif text-lg font-bold">No saved stops yet</h2>
            <p className="text-muted mt-1 text-sm">Tap the star on any stop, on Now or on the map, to keep it here.</p>
          </div>
        ) : null}
        {pins.map((id) => {
          const s = stops.get(id)?.stop ?? pack?.stops.find((x) => x.id === id);
          if (!s) return null;
          const walk =
            location.kind === 'ok'
              ? estimateWalk(haversineMeters(location.lat, location.lon, s.latitude, s.longitude), pace, s.isStation ? STATION_ENTRY_SECONDS : 0)
              : null;
          return (
            <StopCard
              key={id}
              stop={s}
              walk={walk}
              entranceName={null}
              board={offline ? (offlineBoards.get(id) ?? live.boards.get(id)) : live.boards.get(id)}
              routes={live.routes.size > 0 ? live.routes : new Map((pack?.routes ?? []).map((r) => [r.id, r]))}
              status={live.status}
              now={now}
              pinned
              onTogglePin={togglePin}
              alerts={alerts.get(id)}
              stepFree={stepFree}
            />
          );
        })}
        <PaceSection />
      </main>
    </>
  );
}
