import { formatWalk, type LiveStatus, type RouteInfo, type StopBoard, type StopSummary, type WalkEstimate } from '@twalk/core';
import { DepartureGroupView } from './Departures.tsx';
import { StarIcon, WalkIcon } from './icons.tsx';

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
}) {
  const { stop, walk, board, routes, status, now } = props;
  const headingId = `stop-${stop.id}`;
  return (
    <article aria-labelledby={headingId} className="bg-surface border-line rounded-2xl border p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg leading-snug font-bold break-words">
            {stop.name}
          </h2>
          {walk ? (
            <p className="text-muted mt-0.5 flex flex-wrap items-center gap-1 text-sm">
              <WalkIcon />
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
          className={`-m-2 flex size-11 shrink-0 items-center justify-center rounded-full ${props.pinned ? 'text-hurry-fg' : 'text-muted'}`}
        >
          <StarIcon filled={props.pinned} />
        </button>
      </header>
      {!board ? (
        <p className="text-muted text-sm">Loading departures…</p>
      ) : board.groups.length === 0 ? (
        <p className="text-muted text-sm">No departures in the next 90 minutes.</p>
      ) : (
        <div className="space-y-3">
          {board.groups.map((g) => (
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
    </article>
  );
}
