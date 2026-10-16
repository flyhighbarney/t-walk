import { formatWalk, type AlertView, type LiveStatus, type RouteInfo, type StopBoard, type StopSummary, type WalkEstimate } from '@twalk/core';
import { AlertList } from './Alerts.tsx';
import { navigate } from '../lib/router.ts';
import { DepartureGroupView } from './Departures.tsx';
import { MapIcon, RouteIcon, StarIcon, WalkIcon } from './icons.tsx';
import { chipColors } from './RouteChip.tsx';

export function StopCard(props: {
  stop: StopSummary;
  walk: WalkEstimate | null;
  entranceName: string | null;
  board: StopBoard | undefined;
  routes: Map<string, RouteInfo>;
  status: LiveStatus | null;
  now: number;
  pinned: boolean;
  onTogglePin: (id: string) => void;
  /** Off inside the map's own stop sheet. */
  showMapLink?: boolean;
  /** Only these routes (the stop sheet's line filter). */
  routeFilter?: string | null;
  /** The sheet around it already shows the name. */
  hideName?: boolean;
  alerts?: AlertView[];
  stepFree?: boolean;
}) {
  const { stop, walk, board, routes, status, now } = props;
  const headingId = `stop-${stop.id}`;
  const lineColors = [...new Set(stop.routeIds.map((id) => routes.get(id)).filter((r) => r && r.mode !== 'bus' && r.listed).map((r) => chipColors(r!).background))].slice(0, 4);
  const groups = board?.groups.filter((g) => !props.routeFilter || g.routeId === props.routeFilter) ?? [];
  return (
    <article aria-labelledby={headingId} className="bg-surface rounded-2xl p-4">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className={props.hideName ? 'visually-hidden' : 'flex items-center gap-2 text-2xl leading-tight font-extrabold break-words'}>
            {lineColors.length > 0 ? (
              <span className="flex shrink-0 gap-1" aria-hidden>
                {lineColors.map((c) => (
                  <span key={c} className="size-3 rounded-full" style={{ background: c }} />
                ))}
              </span>
            ) : null}
            {stop.name}
          </h2>
          {walk ? (
            <p className="text-muted mt-1 flex flex-wrap items-center gap-1 text-[15px]">
              <WalkIcon className="text-brand-text" />
              <span>{formatWalk(walk.seconds)}</span>
              {props.entranceName ? <span>· via {props.entranceName.replace(`${stop.name} - `, '')}</span> : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => props.onTogglePin(stop.id)}
          aria-pressed={props.pinned}
          aria-label={props.pinned ? `Unpin ${stop.name}` : `Pin ${stop.name}`}
          className={`-m-2 flex size-11 shrink-0 items-center justify-center rounded-full ${props.pinned ? 'text-star' : 'text-muted'}`}
        >
          <StarIcon filled={props.pinned} />
        </button>
      </header>
      {props.alerts?.length ? (
        <div className="-mt-1 mb-3">
          <AlertList alerts={props.alerts} stepFree={props.stepFree} max={2} />
        </div>
      ) : null}
      {!board ? (
        <p className="text-muted text-sm">Loading departures…</p>
      ) : groups.length === 0 ? (
        <p className="text-muted text-sm">No departures in the next 90 minutes.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <DepartureGroupView
              key={`${g.routeId}|${g.directionId}`}
              group={g}
              route={routes.get(g.routeId)}
              now={now}
              walk={walk}
              health={status?.predictions[g.mode]}
            />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-x-5">
        {props.showMapLink !== false ? (
          <InAppLink href={`/map?stop=${encodeURIComponent(stop.id)}`}>
            <MapIcon className="size-4" /> Show on map
          </InAppLink>
        ) : null}
        <InAppLink href={`/trips?from=${stop.latitude.toFixed(5)},${stop.longitude.toFixed(5)}&fromName=${encodeURIComponent(stop.name)}`}>
          <RouteIcon className="size-4" /> Plan from here
        </InAppLink>
      </div>
    </article>
  );
}

function InAppLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      className="text-brand-text inline-flex min-h-11 items-center gap-1.5 text-sm font-bold"
    >
      {children}
    </a>
  );
}
