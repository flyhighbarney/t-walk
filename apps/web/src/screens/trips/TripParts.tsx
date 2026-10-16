// A trip as a result card, and as a step-by-step detail.

import { useState } from 'react';
import {
  RISK_LABEL,
  bestTime,
  describeTransfer,
  formatClock,
  formatDistance,
  formatMinutes,
  type RiskLevel,
  type TripLeg,
  type TripOption,
} from '@twalk/core';
import { CheckIcon, ClockIcon, HurryIcon, WalkIcon, WarnIcon, WheelchairIcon } from '../../components/icons.tsx';

export const clock = (ms: number) => formatClock(ms).full;
export const minutes = (s: number) => formatMinutes(Math.max(1, Math.round(s / 60))).text;
export const money = (cents: number) => (cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`);

export function readable(hex: string | null): { background: string; color: string } {
  const bg = hex && /^[0-9a-f]{6}$/i.test(hex) ? hex : '666666';
  const n = Number.parseInt(bg, 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return { background: `#${bg}`, color: lum > 0.55 ? '#000000' : '#ffffff' };
}

export function LegChip({ leg }: { leg: TripLeg }) {
  if (!leg.transit) {
    return (
      <span className="text-muted inline-flex items-center gap-0.5 text-sm font-semibold">
        <WalkIcon /> {Math.max(1, Math.round(leg.durationS / 60))}
      </span>
    );
  }
  return (
    <span className="rounded-md px-1.5 py-0.5 text-sm font-bold" style={readable(leg.color)}>
      {leg.routeLabel ?? leg.mode}
    </span>
  );
}

const RISK_STYLE: Record<RiskLevel, string> = {
  none: 'bg-surface-3 text-text',
  low: 'bg-ok-bg text-ok-fg',
  medium: 'bg-hurry-bg text-hurry-fg',
  high: 'bg-miss-bg text-miss-fg',
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  const Icon = level === 'high' ? WarnIcon : level === 'medium' ? HurryIcon : CheckIcon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${RISK_STYLE[level]}`}>
      <Icon /> {RISK_LABEL[level]}
    </span>
  );
}

const SOURCE: Record<TripLeg['source'], string> = { live: 'Live', estimate: 'Estimate', vehicle: 'Scheduled', scheduled: 'Scheduled', walk: '' };

export function SourceTag({ source }: { source: TripLeg['source'] }) {
  if (source === 'walk') return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${source === 'live' ? 'text-live font-semibold' : 'text-muted'}`}>
      {source === 'live' ? <span className="live-dot size-2 rounded-full bg-current" aria-hidden /> : <ClockIcon />}
      {SOURCE[source]}
    </span>
  );
}

export function TripCard({ option, onOpen, tag }: { option: TripOption; onOpen: () => void; tag?: string }) {
  const firstTransit = option.legs.find((l) => l.transit);
  const spoken = [
    `${clock(option.start)} to ${clock(option.end)}`,
    option.alsoAt.length > 0 ? `also at ${option.alsoAt.map(clock).join(', ')}` : '',
    minutes(option.durationS),
    option.walkOnly ? 'walking all the way' : `${option.transfers} ${option.transfers === 1 ? 'transfer' : 'transfers'}`,
    `${minutes(option.walkS)} walking`,
    option.fare?.cents != null ? money(option.fare.cents) : '',
    option.walkOnly ? '' : RISK_LABEL[option.risk.level],
    firstTransit ? (firstTransit.source === 'live' ? 'live times' : 'scheduled times') : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button type="button" onClick={onOpen} className="bg-surface w-full rounded-xl p-4 text-left">
      <span className="visually-hidden">{spoken}</span>
      <span aria-hidden className="block">
        <span className="flex items-baseline justify-between gap-2">
          <span className="tabular font-mono text-xl font-bold">
            {clock(option.start)} – {clock(option.end)}
          </span>
          <span className="tabular text-lg font-bold">{minutes(option.durationS)}</span>
        </span>
        {tag ? <span className="bg-surface-2 text-accent-text mt-1 inline-block rounded-full px-2 py-0.5 text-sm font-bold">{tag}</span> : null}
        {option.alsoAt.length > 0 ? <span className="text-muted mt-0.5 block text-sm">Also at {option.alsoAt.map(clock).join(', ')}</span> : null}
        {/* Walking all the way is one walker and its minutes: the line below says that already. */}
        {option.walkOnly ? null : (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {option.legs.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 ? <span className="text-muted">›</span> : null}
              <LegChip leg={l} />
            </span>
          ))}
        </span>
        )}
        <span className="text-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>{minutes(option.walkS)} walk</span>
          {!option.walkOnly ? <span>{option.transfers === 0 ? 'No transfers' : `${option.transfers} ${option.transfers === 1 ? 'transfer' : 'transfers'}`}</span> : null}
          {option.fare?.cents != null ? <span className="text-text font-semibold">{money(option.fare.cents)}</span> : null}
          {firstTransit ? <SourceTag source={firstTransit.source} /> : null}
          {option.stepFree ? (
            <span className="inline-flex items-center gap-1">
              <WheelchairIcon className="size-4" /> Step-free
            </span>
          ) : null}
        </span>
        {!option.walkOnly && option.transfers > 0 ? (
          <span className="mt-2 block">
            <RiskBadge level={option.risk.level} />
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function LegView({ leg, next, transfer, onMissed }: { leg: TripLeg; next?: TripLeg; transfer?: string; onMissed?: () => void }) {
  const [showSteps, setShowSteps] = useState(false);
  if (!leg.transit) {
    return (
      <li className="relative flex gap-3 pb-5">
        <span className="text-muted flex w-8 shrink-0 justify-center" aria-hidden>
          <WalkIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            Walk {minutes(leg.durationS)} <span className="text-muted font-normal">({formatDistance(leg.distanceM)})</span>
          </p>
          <p className="text-muted text-sm">to {next?.transit ? next.from.name : leg.to.name}</p>
          {transfer ? <p className="text-muted mt-1 text-xs">{transfer}</p> : null}
          {leg.steps.length > 0 ? (
            <>
              <button type="button" aria-expanded={showSteps} onClick={() => setShowSteps(!showSteps)} className="text-brand-text mt-1 min-h-11 text-sm font-bold">
                {showSteps ? 'Hide directions' : 'Directions'}
              </button>
              {showSteps ? (
                <ol className="text-muted list-decimal space-y-1 pl-5 text-sm">
                  {leg.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : null}
            </>
          ) : null}
        </div>
      </li>
    );
  }
  const depart = bestTime(leg.start);
  const arrive = bestTime(leg.end);
  const late = leg.start.estimated != null ? Math.round((leg.start.estimated - leg.start.scheduled) / 60_000) : 0;
  return (
    <li className="relative flex gap-3 pb-5">
      <span className="flex w-8 shrink-0 justify-center" aria-hidden>
        <span className="w-1.5 rounded-full" style={{ background: readable(leg.color).background }} />
      </span>
      <div className="bg-surface-2 min-w-0 flex-1 rounded-xl p-3">
        <p className="flex flex-wrap items-center gap-2">
          <LegChip leg={leg} />
          <span className="font-bold">{leg.routeName}</span>
          {leg.headsign ? <span className="text-muted">to {leg.headsign}</span> : null}
        </p>
        <p className="mt-2 flex items-baseline justify-between gap-2">
          <span>
            Board at <strong>{leg.from.name}</strong>
            {leg.from.platform && leg.mode === 'RAIL' ? ` · Track ${leg.from.platform}` : ''}
          </span>
          <span className="tabular shrink-0 font-extrabold">{clock(depart)}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
          <SourceTag source={leg.source} />
          {late >= 2 ? <span className="text-warn-text font-semibold">{late} min late</span> : null}
        </p>
        {leg.stayOn ? <p className="text-accent-text mt-1 text-sm font-semibold">Stay on board: the same vehicle continues</p> : null}
        <p className="text-muted mt-1 text-sm">{leg.stopsBetween > 0 ? `Ride ${leg.stopsBetween + 1} stops` : 'Ride 1 stop'}</p>
        <p className="mt-1 flex items-baseline justify-between gap-2">
          <span>
            Get off at <strong>{leg.to.name}</strong>
          </span>
          <span className="tabular shrink-0 font-extrabold">{clock(arrive)}</span>
        </p>
        {leg.alerts.map((a) => (
          <p key={a} className="bg-warn-bg text-warn-fg mt-2 flex gap-2 rounded-lg p-2 text-sm">
            <WarnIcon className="mt-0.5 shrink-0" /> {a}
          </p>
        ))}
        {onMissed ? (
          <button type="button" onClick={onMissed} className="text-brand-text mt-2 min-h-11 text-sm font-bold">
            What if I miss it?
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function transferNotes(option: TripOption): Map<number, string> {
  // Attach each transfer's note to the walk (or ride) just before the next boarding.
  const notes = new Map<number, string>();
  let t = 0;
  option.legs.forEach((leg, i) => {
    if (leg.transit && i > 0 && option.legs.slice(0, i).some((l) => l.transit)) {
      const check = option.risk.transfers[t++];
      if (check) notes.set(i - 1, `${RISK_LABEL[check.level]}: ${describeTransfer(check)}.`);
    }
  });
  return notes;
}
