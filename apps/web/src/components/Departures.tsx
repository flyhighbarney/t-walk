// One route + direction at a stop, and its departure rows.

import {
  CATCHABILITY_LABEL,
  DOWN_AFTER_SECONDS,
  canMakeIt,
  displayPrediction,
  displayScheduled,
  formatAge,
  formatClock,
  formatHeadway,
  rowLeavesAt,
  staleAfterSeconds,
  type Catchability,
  type DepartureGroup,
  type DepartureRow,
  type FeedHealth,
  type RouteInfo,
  type WalkEstimate,
} from '@twalk/core';
import { CheckIcon, ClockIcon, HurryIcon, MissIcon, VehicleIcon, WarnIcon } from './icons.tsx';
import { RouteChip, routeName } from './RouteChip.tsx';

const ROWS_SHOWN = 3;

interface RowText {
  main: string;
  /** For screen readers: "in 6 minutes" rather than "6 min". */
  spoken: string;
  hidden: boolean;
}

/** "about 1 min" → "about 1 minute", "1 hr 12 min" → "1 hour 12 minutes". */
function spokenDuration(text: string): string {
  return text
    .replace(/\b(\d+) min\b/, (_, n: string) => `${n} ${n === '1' ? 'minute' : 'minutes'}`)
    .replace(/\b(\d+) hr\b/, (_, n: string) => `${n} ${n === '1' ? 'hour' : 'hours'}`);
}

function rowText(g: DepartureGroup, r: DepartureRow, now: number): RowText {
  if (r.canceled) {
    const t = r.scheduledTime ? formatClock(r.scheduledTime).full : '';
    return { main: t, spoken: `${t}, canceled`, hidden: false };
  }
  if (r.source === 'scheduled' || r.source === 'vehicle') {
    const d = displayScheduled(now, r.scheduledTime ?? 0);
    return d.kind === 'hidden' ? { main: '', spoken: '', hidden: true } : { main: d.text, spoken: `at ${d.text}`, hidden: false };
  }
  const d = displayPrediction({
    mode: g.mode,
    now,
    arrivalTime: r.arrivalTime,
    departureTime: r.departureTime,
    status: r.status,
    vehicleStoppedHere: r.vehicleStoppedHere,
  });
  if (d.kind === 'hidden') return { main: '', spoken: '', hidden: true };
  const main = r.source === 'estimate' && d.kind === 'countdown' ? `about ${d.text}` : d.text;
  const spoken = d.kind === 'countdown' ? `in ${spokenDuration(main)}` : d.kind === 'clock' ? `at ${main}` : main;
  return { main, spoken, hidden: false };
}

const SOURCE_LABEL: Record<DepartureRow['source'], string> = {
  live: 'Live',
  estimate: 'Estimate',
  vehicle: 'Scheduled · vehicle on route',
  scheduled: 'Scheduled',
};

const SOURCE_SPOKEN: Record<DepartureRow['source'], string> = {
  live: 'live prediction',
  estimate: 'estimate from the schedule, not live',
  vehicle: 'scheduled time; a vehicle is on this trip but has no prediction here',
  scheduled: 'scheduled time, not live',
};

function SourceLabel({ source }: { source: DepartureRow['source'] }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${source === 'live' ? 'text-live font-semibold' : 'text-muted'}`}>
      {source === 'live' ? <span className="live-dot inline-block size-2 rounded-full bg-current" aria-hidden /> : null}
      {source === 'vehicle' ? <VehicleIcon /> : null}
      {source === 'scheduled' || source === 'estimate' ? <ClockIcon /> : null}
      {SOURCE_LABEL[source]}
    </span>
  );
}

const CATCH_STYLE: Record<Catchability, string> = {
  comfortable: 'bg-ok-bg text-ok-fg',
  hurry: 'bg-hurry-bg text-hurry-fg',
  miss: 'bg-miss-bg text-miss-fg',
};

function CatchBadge({ level }: { level: Catchability }) {
  const Icon = level === 'comfortable' ? CheckIcon : level === 'hurry' ? HurryIcon : MissIcon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${CATCH_STYLE[level]}`}>
      <Icon />
      {CATCHABILITY_LABEL[level]}
    </span>
  );
}

function Row(props: {
  group: DepartureGroup;
  row: DepartureRow;
  now: number;
  walk: WalkEstimate | null;
  stale: boolean;
}) {
  const { group: g, row: r, now, walk } = props;
  const t = rowText(g, r, now);
  const leavesAt = rowLeavesAt(r);
  const catchInfo = walk && leavesAt != null && !r.canceled ? canMakeIt({ now, leavesAt, walk, source: r.source }) : null;
  const notes: string[] = [];
  if (r.canceled) notes.push('Canceled');
  if (r.mayNotRun) notes.push('May not run: nothing live on this trip yet');
  if (r.stalled) notes.push('Delayed: the vehicle may be stopped');
  if (g.mode === 'commuter_rail' && r.status) notes.push(r.status);
  if (r.track) notes.push(`Track ${r.track}`);
  if (r.lastTrip) notes.push('Last trip');

  const spoken = [
    r.headsign,
    t.spoken,
    SOURCE_SPOKEN[r.source],
    ...notes,
    catchInfo ? CATCHABILITY_LABEL[catchInfo.level] : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li className={`bg-surface-2 flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 ${props.stale ? 'opacity-60' : ''}`}>
      <span className="visually-hidden">{spoken}</span>
      <div className="min-w-0 flex-1" aria-hidden>
        <div className="text-[17px] leading-snug font-bold break-words">{r.headsign}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <SourceLabel source={r.source} />
          {notes.map((n) => (
            <span
              key={n}
              className={`inline-flex items-center gap-1 text-xs ${r.mayNotRun || r.canceled || r.stalled ? 'text-warn-text font-semibold' : 'text-muted'}`}
            >
              {r.mayNotRun || r.stalled ? <WarnIcon /> : null}
              {n}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1" aria-hidden>
        <span className={`tabular text-xl leading-tight font-extrabold ${r.canceled ? 'text-muted line-through' : ''}`}>{t.main}</span>
        {catchInfo ? <CatchBadge level={catchInfo.level} /> : null}
      </div>
    </li>
  );
}

export function DepartureGroupView(props: {
  group: DepartureGroup;
  route: RouteInfo | undefined;
  now: number;
  walk: WalkEstimate | null;
  health: FeedHealth | undefined;
}) {
  const { group: g, route, now, walk, health } = props;
  // Age from the latest status we have, so it keeps growing if our own connection drops.
  const age = health?.lastUpdateAt != null && g.dataAgeSeconds != null ? Math.max(0, (now - health.lastUpdateAt) / 1000) : null;
  const stale = age != null && age > staleAfterSeconds(g.mode);
  const veryOld = age != null && age > DOWN_AFTER_SECONDS;

  const visible = g.rows.filter((r) => !rowText(g, r, now).hidden).slice(0, ROWS_SHOWN);
  const destination = g.destination || g.directionName;
  const headingId = `g-${g.routeId}-${g.directionId}`;

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {route ? <RouteChip route={route} /> : null}
        <span className="font-semibold">{route ? routeName(route) : g.routeId}</span>
        <span className="text-muted">
          {g.directionName}
          {destination && destination !== g.directionName ? ` to ${destination}` : ''}
        </span>
      </h3>
      {g.liveUnavailable ? (
        <p className="text-warn-text mt-1 text-xs font-semibold">Live times unavailable: showing the schedule</p>
      ) : null}
      {g.headway && visible.length === 0 ? (
        <p className="mt-1 text-sm">
          <span className="font-semibold">{formatHeadway(g.headway.minMinutes, g.headway.maxMinutes).text}</span>{' '}
          <span className="text-muted inline-flex items-center gap-1 text-xs">
            <ClockIcon /> Scheduled; no live predictions right now
          </span>
        </p>
      ) : null}
      {!g.headway && visible.length === 0 ? <p className="text-muted mt-1 text-sm">No more departures in the next 90 minutes.</p> : null}
      {visible.length > 0 ? (
        <ul className="space-y-2">
          {visible.map((r) => (
            <Row key={r.key} group={g} row={r} now={now} walk={walk} stale={stale} />
          ))}
        </ul>
      ) : null}
      {age != null && stale ? (
        <p className={`mt-1 text-xs ${veryOld ? 'text-warn-text font-semibold' : 'text-muted'}`} role={veryOld ? 'status' : undefined}>
          {veryOld ? `Out of date: ${formatAge(age)}` : formatAge(age)}
        </p>
      ) : null}
    </section>
  );
}
