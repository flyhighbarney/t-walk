// Alerts for a stop, trip or commute: in effect first, most serious first,
// three shown and the rest behind a button. Each has an icon and a word for
// its kind, so colour is never the only signal.

import { useEffect, useId, useState } from 'react';
import type { AlertKind, AlertView } from '@twalk/core';
import { getJson } from '../lib/api.ts';
import { usePageVisible } from '../lib/live.ts';
import { ClockIcon, WarnIcon, WheelchairIcon } from './icons.tsx';

const KIND_LABEL: Record<AlertKind, string> = {
  suspension: 'No service',
  shuttle: 'Shuttle buses',
  closure: 'Closed',
  detour: 'Detour',
  delay: 'Delays',
  elevator: 'Elevator out',
  escalator: 'Escalator out',
  accessibility: 'Access issue',
  'stop-move': 'Stop moved',
  'service-change': 'Service change',
  info: 'Notice',
};

const SERIOUS = new Set<AlertKind>(['suspension', 'shuttle', 'closure', 'detour']);

export function AlertList({ alerts, max = 3, stepFree = false }: { alerts: AlertView[]; max?: number; stepFree?: boolean }) {
  const [all, setAll] = useState(false);
  const id = useId();
  if (alerts.length === 0) return null;
  const shown = all ? alerts : alerts.slice(0, max);
  return (
    <section aria-labelledby={id} className="mt-3 space-y-2">
      <h3 id={id} className="visually-hidden">
        Alerts
      </h3>
      {shown.map((a) => {
        const serious = SERIOUS.has(a.kind) && !a.upcoming;
        const access = a.accessibility && stepFree;
        const Icon = a.accessibility ? WheelchairIcon : a.upcoming ? ClockIcon : WarnIcon;
        return (
          <details key={a.id} className={`rounded-xl px-3 py-2 text-sm ${serious || access ? 'bg-warn-bg text-warn-fg' : 'bg-surface-2'}`}>
            <summary className="flex min-h-9 cursor-pointer list-none items-start gap-2">
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="font-bold">{a.upcoming ? `Planned: ${KIND_LABEL[a.kind]}` : KIND_LABEL[a.kind]}</span>
                <span className="opacity-80"> · {a.when}</span>
                <span className="block break-words">{a.header}</span>
              </span>
            </summary>
            {a.description ? <p className="mt-2 text-sm whitespace-pre-line opacity-90">{a.description}</p> : null}
            {a.url ? (
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block min-h-9 font-semibold underline">
                More from the MBTA
              </a>
            ) : null}
          </details>
        );
      })}
      {alerts.length > max ? (
        <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className="text-brand-text min-h-11 text-sm font-bold">
          {all ? 'Show fewer alerts' : `${alerts.length - max} more ${alerts.length - max === 1 ? 'alert' : 'alerts'}`}
        </button>
      ) : null}
    </section>
  );
}

/** Alerts for these stops, refreshed every minute while the page is visible. */
export function useStopAlerts(stopIds: string[], stepFree: boolean): Map<string, AlertView[]> {
  const visible = usePageVisible();
  const [byStop, setByStop] = useState<Map<string, AlertView[]>>(new Map());
  const key = [...new Set(stopIds)].sort().join(',');
  useEffect(() => {
    if (!key || !visible) return;
    const ac = new AbortController();
    const load = () =>
      getJson<{ byStop: Record<string, AlertView[]> }>(`/api/alerts?stops=${encodeURIComponent(key)}${stepFree ? '&stepFree=1' : ''}`, ac.signal)
        .then((r) => setByStop(new Map(Object.entries(r.byStop))))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      ac.abort();
      window.clearInterval(t);
    };
  }, [key, stepFree, visible]);
  return byStop;
}

/** Alerts for a trip or commute: the stops it uses and its lines. */
export function useTripAlerts(stopIds: string[], routeIds: string[], stepFree: boolean): AlertView[] {
  const visible = usePageVisible();
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const stops = [...new Set(stopIds)].sort().join(',');
  const routes = [...new Set(routeIds)].sort().join(',');
  useEffect(() => {
    if ((!stops && !routes) || !visible) return;
    const ac = new AbortController();
    getJson<{ alerts: AlertView[] }>(`/api/alerts?trip=1&stops=${encodeURIComponent(stops)}&routes=${encodeURIComponent(routes)}${stepFree ? '&stepFree=1' : ''}`, ac.signal)
      .then((r) => setAlerts(r.alerts))
      .catch(() => {});
    return () => ac.abort();
  }, [stops, routes, stepFree, visible]);
  return alerts;
}
