// The map's other sheets: a stop's departures, a Bluebikes station, the
// layers panel, and the list of what's in view (the non-visual way into the map).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  STATION_ENTRY_SECONDS,
  estimateWalk,
  formatAge,
  haversineMeters,
  type BikeStation,
  type MapStation,
  type MapVehicle,
  type RouteInfo,
  type StopResponse,
  type WalkPace,
} from '@twalk/core';
import { BikeIcon, BusIcon, FerryIcon, TrainIcon } from '../../components/icons.tsx';
import { StopCard } from '../../components/StopCard.tsx';
import { chipColors } from '../../components/RouteChip.tsx';
import { fetchStop } from '../../lib/api.ts';
import { useLiveBoards, useNow } from '../../lib/live.ts';
import { useStepFree, type MapLayers } from '../../lib/storage.ts';
import { useStopAlerts } from '../../components/Alerts.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { BIKE_COLOR } from './mapStyle.ts';
import { CrowdingDots, occupancyInfo } from './VehicleSheet.tsx';

export function StopSheet(props: {
  stopId: string;
  onClose: () => void;
  here: { lat: number; lon: number } | null;
  pace: WalkPace;
  pinned: boolean;
  onTogglePin: (id: string) => void;
}) {
  const [data, setData] = useState<StopResponse | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    const ac = new AbortController();
    setData(null);
    setFilter(null);
    fetchStop(props.stopId, ac.signal)
      .then(setData)
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(true);
      });
    return () => ac.abort();
  }, [props.stopId]);

  const seed = useMemo(() => (data ? { boards: [data.board], routes: data.routes, status: data.status } : undefined), [data]);
  const ids = useMemo(() => (data ? [data.stop.id] : []), [data]);
  const live = useLiveBoards(ids, seed);
  const [stepFree] = useStepFree();
  const alerts = useStopAlerts(ids, stepFree);
  const stop = data?.stop;
  const walk =
    stop && props.here
      ? estimateWalk(haversineMeters(props.here.lat, props.here.lon, stop.latitude, stop.longitude), props.pace, stop.isStation ? STATION_ENTRY_SECONDS : 0)
      : null;
  const board = stop ? live.boards.get(stop.id) : undefined;
  const lineRoutes = [...new Set(board?.groups.map((g) => g.routeId) ?? [])]
    .map((id) => live.routes.get(id))
    .filter((r): r is RouteInfo => r != null);

  return (
    <BottomSheet title={stop?.name ?? 'Stop'} label={stop?.name ?? 'Stop'} onClose={props.onClose}>
      {error ? <p className="text-miss-fg text-sm">Couldn't load this stop. Try again in a moment.</p> : null}
      {!stop && !error ? <p className="text-muted text-sm">Loading departures…</p> : null}
      {stop ? (
        <>
          {lineRoutes.length > 1 ? (
            <div role="group" aria-label="Show lines" className="no-scrollbar -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
              <FilterChip active={filter == null} onClick={() => setFilter(null)}>
                All departures
              </FilterChip>
              {lineRoutes.map((r) => (
                <FilterChip key={r.id} active={filter === r.id} onClick={() => setFilter(filter === r.id ? null : r.id)}>
                  <span className="size-2.5 rounded-full" style={{ background: chipColors(r).background }} aria-hidden />
                  {r.mode === 'bus' ? `Route ${r.shortName}` : r.longName.replace(/ Line$/, '')}
                </FilterChip>
              ))}
            </div>
          ) : null}
          <div className="-mx-4">
            <StopCard
              stop={stop}
              walk={walk}
              entranceName={null}
              board={board}
              routes={live.routes}
              status={live.status}
              now={now}
              pinned={props.pinned}
              onTogglePin={props.onTogglePin}
              showMapLink={false}
              routeFilter={filter}
              hideName
              alerts={stop ? alerts.get(stop.id) : undefined}
              stepFree={stepFree}
            />
          </div>
        </>
      ) : null}
    </BottomSheet>
  );
}

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold ${active ? 'bg-brand text-on-brand' : 'bg-surface-2 text-text'}`}
    >
      {children}
    </button>
  );
}

export function BikeSheet({ station, updatedAt, onClose }: { station: BikeStation; updatedAt: number | null; onClose: () => void }) {
  const now = useNow();
  const reported = station.reportedAt ?? updatedAt;
  return (
    <BottomSheet title={station.name} label={`Bluebikes station ${station.name}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Bikes" value={station.bikes} note={station.ebikes > 0 ? `${station.ebikes} electric` : undefined} />
        <Stat label="Open docks" value={station.docks} />
      </div>
      {!station.renting ? <p className="text-warn-fg mt-3 text-sm font-semibold">Not renting bikes right now.</p> : null}
      {!station.returning ? <p className="text-warn-fg mt-1 text-sm font-semibold">Not taking returns right now.</p> : null}
      <p className="text-muted mt-3 text-sm">
        <span style={{ color: BIKE_COLOR }}>
          <BikeIcon className="mr-1 inline size-4" />
        </span>
        Bluebikes station{reported ? ` · ${formatAge((now - reported) / 1000)}` : ''}. Counts change quickly; check the dock when you get there.
      </p>
    </BottomSheet>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="bg-surface-2 rounded-2xl p-3">
      <div className="text-muted text-xs font-bold tracking-widest uppercase">{label}</div>
      <div className="tabular text-3xl font-extrabold">{value}</div>
      {note ? <div className="text-muted text-xs">{note}</div> : null}
    </div>
  );
}

function Switch(props: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void; icon: ReactNode }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-3 py-2">
      <span className="bg-surface-2 text-brand-text flex size-11 shrink-0 items-center justify-center rounded-xl" aria-hidden>
        {props.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{props.label}</span>
        <span className="text-muted block text-sm">{props.description}</span>
      </span>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="peer-checked:bg-brand bg-surface-3 peer-focus-visible:outline-focus relative h-8 w-14 shrink-0 rounded-full peer-focus-visible:outline-3 after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-6"
      />
    </label>
  );
}

export function LayersSheet({ layers, onChange, onClose }: { layers: MapLayers; onChange: (l: MapLayers) => void; onClose: () => void }) {
  const set = (patch: Partial<MapLayers>) => onChange({ ...layers, ...patch });
  return (
    <BottomSheet title="Map layers" label="Map layers" onClose={onClose}>
      <div className="divide-line divide-y">
        <Switch icon={<TrainIcon />} label="Vehicles" description="Live positions, pointing the way they're going" checked={layers.vehicles} onChange={(vehicles) => set({ vehicles })} />
        <Switch icon={<span className="size-3 rounded-full border-2 border-current" />} label="Stops and stations" description="Tap one for its departures" checked={layers.stops} onChange={(stops) => set({ stops })} />
        <Switch icon={<span className="h-1 w-6 rounded-full bg-current" />} label="Route lines" description="Subway, Commuter Rail and ferry" checked={layers.lines} onChange={(lines) => set({ lines })} />
        <Switch icon={<BikeIcon />} label="Bluebikes stations" description="Bikes and open docks, updated every minute" checked={layers.bikes} onChange={(bikes) => set({ bikes })} />
        <Switch icon={<CrowdingDots dots={2} />} label="Show crowding" description="How full a vehicle is, where it's reported" checked={layers.crowding} onChange={(crowding) => set({ crowding })} />
      </div>
    </BottomSheet>
  );
}

const MODE_ICON = { bus: BusIcon, ferry: FerryIcon } as const;

export function InViewSheet(props: {
  vehicles: MapVehicle[];
  stations: MapStation[];
  center: { lat: number; lon: number };
  onVehicle: (id: string) => void;
  onStop: (id: string) => void;
  onClose: () => void;
}) {
  const near = (lat: number, lon: number) => haversineMeters(props.center.lat, props.center.lon, lat, lon);
  const vehicles = [...props.vehicles].sort((a, b) => near(a.latitude, a.longitude) - near(b.latitude, b.longitude)).slice(0, 40);
  const stations = [...props.stations].sort((a, b) => near(a.latitude, a.longitude) - near(b.latitude, b.longitude)).slice(0, 20);
  return (
    <BottomSheet title="In view" label="Vehicles and stations in view" onClose={props.onClose}>
      <h3 className="text-muted mb-2 text-xs font-bold tracking-widest uppercase">Stations</h3>
      {stations.length === 0 ? <p className="text-muted mb-4 text-sm">No stations in view.</p> : null}
      <ul className="mb-5 space-y-2">
        {stations.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => props.onStop(s.id)} className="bg-surface-2 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left">
              <span className="size-3 shrink-0 rounded-full" style={{ background: `#${s.color}` }} aria-hidden />
              <span className="font-bold">{s.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <h3 className="text-muted mb-2 text-xs font-bold tracking-widest uppercase">Vehicles, nearest first</h3>
      {vehicles.length === 0 ? <p className="text-muted text-sm">No vehicles in view.</p> : null}
      <ul className="space-y-2">
        {vehicles.map((v) => {
          const Icon = v.mode === 'bus' || v.mode === 'ferry' ? MODE_ICON[v.mode] : TrainIcon;
          const occ = occupancyInfo(v.occupancy);
          return (
            <li key={v.id}>
              <button type="button" onClick={() => props.onVehicle(v.id)} className="bg-surface-2 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-white" style={{ background: `#${v.color}` }} aria-hidden>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    {v.routeLabel} to {v.headsign ?? 'its destination'}
                  </span>
                  {occ ? <span className="text-muted text-xs">{occ.words}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
