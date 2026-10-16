// A vehicle's sheet: where it's going, how full it is, and its next stops
// from live predictions (refreshed every 10 s while open).

import { useEffect, useState } from 'react';
import { displayPrediction, formatAge, staleAfterSeconds, type MapVehicle, type VehicleDetail } from '@twalk/core';
import { RouteChip, routeName } from '../../components/RouteChip.tsx';
import { getJson } from '../../lib/api.ts';
import { useNow } from '../../lib/live.ts';
import { BottomSheet } from './BottomSheet.tsx';

const OCCUPANCY: Record<string, { words: string; dots: number }> = {
  EMPTY: { words: 'Empty', dots: 0 },
  MANY_SEATS_AVAILABLE: { words: 'Many seats', dots: 1 },
  FEW_SEATS_AVAILABLE: { words: 'Some seats', dots: 2 },
  STANDING_ROOM_ONLY: { words: 'Standing room only', dots: 3 },
  CRUSHED_STANDING_ROOM_ONLY: { words: 'Very crowded', dots: 3 },
  FULL: { words: 'Full', dots: 3 },
  NOT_ACCEPTING_PASSENGERS: { words: 'Not taking passengers', dots: 3 },
};

export function occupancyInfo(code: string | null): { words: string; dots: number } | null {
  return code ? (OCCUPANCY[code] ?? null) : null;
}

export function CrowdingDots({ dots }: { dots: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`size-1.5 rounded-full ${i < dots ? 'bg-brand-text' : 'bg-surface-3'}`} />
      ))}
    </span>
  );
}

export function VehicleSheet({ vehicle, onClose }: { vehicle: MapVehicle; onClose: () => void }) {
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [gone, setGone] = useState(false);
  const now = useNow();

  useEffect(() => {
    const ac = new AbortController();
    const load = () =>
      getJson<VehicleDetail>(`/api/vehicles/${encodeURIComponent(vehicle.id)}`, ac.signal)
        .then((d) => {
          setDetail(d);
          setGone(false);
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setGone(true);
        });
    void load();
    const t = window.setInterval(load, 10_000);
    return () => {
      ac.abort();
      window.clearInterval(t);
    };
  }, [vehicle.id]);

  const route = detail?.route ?? null;
  const v = detail?.vehicle ?? vehicle;
  const age = (now - v.updatedAt) / 1000;
  const stale = age > staleAfterSeconds(v.mode);
  const occ = occupancyInfo(v.occupancy);
  const kind = v.mode === 'bus' ? 'Bus' : v.mode === 'ferry' ? 'Boat' : 'Train';

  return (
    <BottomSheet
      label={`${route ? routeName(route) : v.routeLabel} vehicle`}
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {route ? <RouteChip route={route} /> : null}
          <span>to {v.headsign ?? 'its destination'}</span>
        </span>
      }
      header={
        <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 text-sm">
          <span>
            {kind} {v.label}
          </span>
          {occ ? (
            <span className="bg-surface-2 text-text inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold">
              <CrowdingDots dots={occ.dots} /> {occ.words}
            </span>
          ) : null}
          {stale ? (
            <span className="bg-warn-bg text-warn-fg rounded-full px-2.5 py-1 font-semibold">Last seen {formatAge(age).replace('updated ', '')}</span>
          ) : (
            <span className="bg-surface-2 text-live inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold">
              <span className="live-dot size-2 rounded-full bg-current" aria-hidden /> Live position
            </span>
          )}
        </div>
      }
    >
      {gone ? <p className="text-muted text-sm">This vehicle has stopped reporting its position.</p> : null}
      {!detail && !gone ? <p className="text-muted text-sm">Loading its next stops…</p> : null}
      {detail && detail.stops.length === 0 ? (
        <p className="text-muted text-sm">No live predictions for this trip right now.</p>
      ) : null}
      {detail && detail.stops.length > 0 ? (
        <>
          <h3 className="visually-hidden">Next stops</h3>
          <ol className="relative">
            {detail.stops.slice(0, 12).map((s, i) => {
              const d = s.canceled
                ? null
                : displayPrediction({
                    mode: v.mode,
                    now,
                    // The last stop has no departure; show its arrival.
                    arrivalTime: s.arrivalTime,
                    departureTime: s.departureTime ?? s.arrivalTime,
                    status: v.mode === 'commuter_rail' ? null : s.status,
                    vehicleStoppedHere: v.currentStatus === 'STOPPED_AT' && v.stopId === s.stopId,
                  });
              const text = s.canceled ? 'Skipped' : d && d.kind !== 'hidden' ? d.text : '';
              return (
                <li key={`${s.stopId}-${i}`} className="relative flex items-start gap-3 pb-4 last:pb-0">
                  <span className="relative flex w-5 shrink-0 justify-center" aria-hidden>
                    {i < Math.min(detail.stops.length, 12) - 1 ? (
                      <span className="absolute top-3 h-[calc(100%+1rem)] w-1 rounded-full" style={{ background: `#${v.color}`, opacity: 0.45 }} />
                    ) : null}
                    <span
                      className={`relative mt-1 rounded-full border-2 border-white ${i === 0 ? 'size-5' : 'size-3.5'}`}
                      style={{ background: `#${v.color}` }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block font-bold break-words ${i === 0 ? 'text-lg' : ''} ${s.canceled ? 'text-muted line-through' : ''}`}>{s.name}</span>
                  </span>
                  <span className={`tabular shrink-0 text-lg font-extrabold ${stale ? 'opacity-60' : ''}`}>{text}</span>
                </li>
              );
            })}
          </ol>
          <p className="text-muted mt-4 text-xs">Times are live predictions{stale ? ', but this vehicle has gone quiet, so they may be out of date' : ''}.</p>
        </>
      ) : null}
    </BottomSheet>
  );
}
