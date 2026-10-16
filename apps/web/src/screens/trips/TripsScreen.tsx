// Trips: plan door to door. From/to, leave now / leave at / arrive by,
// step-free, and the four ways to sort. Tap a result for its steps, its
// route on a map, and "What if I miss it?" for each ride. Start opens
// navigation. The question (from, to, when, sort) and the open trip live in the
// URL, so refresh, Back and shared links all work.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { RISK_LABEL, bestTime, describeTransfer, saferAlternative, sortOptions, type PlanResponse, type PlanSort, type TripOption } from '@twalk/core';
import { AppHeader } from '../../components/Shell.tsx';
import { StepFreeSwitch } from '../../components/StepFreeSwitch.tsx';
import { SwapIcon, WarnIcon } from '../../components/icons.tsx';
import { useLocation } from '../../lib/location.ts';
import { navigate, searchParam } from '../../lib/router.ts';
import { loadGo, saveGo } from '../../lib/navigation.ts';
import { serverNow } from '../../lib/live.ts';
import { useLocationOptIn, useStepFree, useWalkPace } from '../../lib/storage.ts';
import { FilterChip } from '../map/OtherSheets.tsx';
import { AlertList, useTripAlerts } from '../../components/Alerts.tsx';
import { PlaceField } from './PlaceField.tsx';
import { LegView, TripCard, clock, minutes, money, transferNotes } from './TripParts.tsx';
import { bostonLocalNow, fetchPlan, planUrl, type Place, type TimeMode } from './tripsApi.ts';

const TripMap = lazy(() => import('./TripMap.tsx'));

const SORTS: { value: PlanSort; label: string }[] = [
  { value: 'fastest', label: 'Fastest' },
  { value: 'least-walking', label: 'Least walking' },
  { value: 'fewest-transfers', label: 'Fewest transfers' },
  { value: 'most-reliable', label: 'Most reliable' },
];

const HERE: Place = { name: 'My location', lat: 0, lon: 0, isHere: true };

function placeFromParams(path: string, which: 'from' | 'to'): Place | null {
  const raw = searchParam(path, which);
  if (raw === 'here') return HERE;
  const [lat, lon] = (raw ?? '').split(',').map(Number);
  if (!raw || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: searchParam(path, `${which}Name`) ?? 'Chosen place', lat: lat!, lon: lon! };
}

function placeParams(q: URLSearchParams, which: 'from' | 'to', p: Place | null): void {
  if (!p) return;
  if (p.isHere) return q.set(which, 'here');
  q.set(which, `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`);
  q.set(`${which}Name`, p.name);
}

const TIME_MODES: TimeMode[] = ['now', 'leave', 'arrive'];
const SORT_VALUES: PlanSort[] = ['fastest', 'least-walking', 'fewest-transfers', 'most-reliable'];

export default function TripsScreen({ path }: { path: string }) {
  const [optIn, setOptIn] = useLocationOptIn();
  const location = useLocation(optIn);
  const here = location.kind === 'ok' ? { lat: location.lat, lon: location.lon } : null;
  const [pace] = useWalkPace();
  const [stepFree, setStepFree] = useStepFree();
  const [from, setFrom] = useState<Place | null>(() => placeFromParams(path, 'from') ?? (optIn ? HERE : null));
  const [to, setTo] = useState<Place | null>(() => placeFromParams(path, 'to'));
  const [timeMode, setTimeMode] = useState<TimeMode>(() => TIME_MODES.find((m) => m === searchParam(path, 'when')) ?? 'now');
  const [localTime, setLocalTime] = useState(() => searchParam(path, 'time') ?? bostonLocalNow(Date.now()));
  const [sort, setSort] = useState<PlanSort>(() => SORT_VALUES.find((s) => s === searchParam(path, 'sort')) ?? 'fastest');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  // The open trip is a step in history: Back closes it.
  const openId = searchParam(path, 'open');
  const [inProgress] = useState(() => loadGo(serverNow()));

  // No location: "My location" can't be the start.
  useEffect(() => {
    if ((location.kind === 'denied' || location.kind === 'unavailable') && from?.isHere) setFrom(null);
  }, [location.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const q = new URLSearchParams();
    placeParams(q, 'from', from);
    placeParams(q, 'to', to);
    if (timeMode !== 'now') {
      q.set('when', timeMode);
      q.set('time', localTime);
    }
    if (sort !== 'fastest') q.set('sort', sort);
    return q;
  }, [from, to, timeMode, localTime, sort]);
  useEffect(() => {
    const q = new URLSearchParams(query);
    if (openId) q.set('open', openId);
    const s = q.toString();
    navigate(s ? `/trips?${s}` : '/trips', { replace: true });
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const setOpenId = (id: string | null) => {
    if (id) {
      const q = new URLSearchParams(query);
      q.set('open', id);
      navigate(`/trips?${q}`);
    } else if (history.state?.twalkOpened) history.back();
    else navigate(`/trips?${query}`, { replace: true });
  };
  const [missed, setMissed] = useState<{ legIndex: number; text: string } | null>(null);

  // "My location" follows the device.
  const resolve = (p: Place | null): Place | null => (p?.isHere ? (here ? { ...p, lat: here.lat, lon: here.lon } : null) : p);
  const rFrom = resolve(from);
  const rTo = resolve(to);
  const input = rFrom && rTo ? { from: rFrom, to: rTo, timeMode, localTime, stepFree, pace, sort } : null;
  const url = input ? planUrl(input) : null;
  // Re-plan only when the question changes, not when the device moves a few metres.
  const key = url?.replace(/(from|to)=([-\d.]+),([-\d.]+)/g, (_, k: string, a: string, b: string) => `${k}=${Number(a).toFixed(3)},${Number(b).toFixed(3)}`).replace(/&sort=[^&]+/, '');

  useEffect(() => {
    if (!url) return;
    const ac = new AbortController();
    setState('loading');
    setMissed(null);
    fetchPlan(url, ac.signal)
      .then((r) => {
        setPlan(r);
        setState('idle');
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return;
        setState('error');
        setError(String((e as Error).message).includes('503') ? "The trip planner isn't available right now. Try again in a minute." : "Couldn't plan that trip. Check your connection.");
      });
    return () => ac.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(() => (plan ? sortOptions(plan.options, sort, timeMode === 'arrive') : []), [plan, sort, timeMode]);
  // After a refresh the plan is fetched again and start times move a little, so
  // fall back to the same rides (the id's part after the start time).
  const rides = (id: string) => id.slice(id.indexOf('-'));
  const open = openId ? (options.find((o) => o.id === openId) ?? options.find((o) => rides(o.id) === rides(openId)) ?? null) : null;
  const openRides = open?.legs.filter((l) => l.transit) ?? [];
  const tripAlerts = useTripAlerts(
    openRides.flatMap((l) => [l.from.stopId, l.to.stopId]).filter((s): s is string => !!s),
    openRides.map((l) => l.routeId).filter((r): r is string => !!r),
    stepFree,
  );

  const useHere = (set: (p: Place) => void) => {
    if (!optIn) setOptIn(true);
    set(HERE);
  };

  const start = (option: TripOption) => {
    const dest = option.legs[option.legs.length - 1]!.to;
    saveGo({
      option,
      startedAt: serverNow(),
      progress: { legIndex: 0, onBoard: false, arrived: false },
      to: { name: rTo && !rTo.isHere ? rTo.name : dest.name, lat: dest.lat, lon: dest.lon },
      stepFree,
      share: null,
    });
    navigate('/go');
  };

  const whatIfMissed = async (option: TripOption, legIndex: number) => {
    const leg = option.legs[legIndex]!;
    if (!input) return;
    setMissed({ legIndex, text: 'Looking for the next way…' });
    try {
      const next = await fetchPlan(
        planUrl(input, { from: { name: leg.from.name, lat: leg.from.lat, lon: leg.from.lon }, time: bestTime(leg.start) + 60_000, timeMode: 'leave' }),
      );
      const best = sortOptions(next.options.filter((o) => !o.walkOnly || o.durationS < 30 * 60), 'fastest', false)[0];
      setMissed({
        legIndex,
        text: best
          ? `Next way from ${leg.from.name}: arrive ${clock(best.end)}, ${Math.max(0, Math.round((best.end - option.end) / 60_000))} min later than this trip.`
          : `No other way from ${leg.from.name} soon.`,
      });
    } catch {
      setMissed({ legIndex, text: "Couldn't check right now." });
    }
  };

  if (open) {
    const notes = transferNotes(open);
    const safer = saferAlternative(open, options);
    return (
      <>
        <AppHeader title="Trip">
          <button type="button" onClick={() => setOpenId(null)} className="bg-surface-2 min-h-11 rounded-full px-4 font-bold">
            Back
          </button>
        </AppHeader>
        {/* Start, always in reach above the tab bar, as in the map apps. */}
        <div className="fixed inset-x-0 z-20 px-4" style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={() => start(open)} className="bg-brand text-on-brand shadow-float mx-auto flex min-h-14 w-full max-w-xl items-center justify-center gap-2 rounded-full text-lg font-extrabold">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="currentColor">
              <path d="M12 2 4 21l8-4 8 4z" />
            </svg>
            Start
          </button>
        </div>
        <main className="pb-tabbar mx-auto max-w-xl space-y-4 px-4 pt-2">
          <section aria-labelledby="trip-h" className="bg-surface rounded-xl p-4">
            <h2 id="trip-h" className="tabular font-mono text-2xl font-bold">
              {clock(open.start)} – {clock(open.end)}
            </h2>
            <p className="text-muted mt-1">
              {minutes(open.durationS)} · {minutes(open.walkS)} walking
              {open.fare?.cents != null ? ` · ${money(open.fare.cents)}` : ''}
            </p>
            {open.risk.level === 'high' || open.risk.level === 'medium' ? (
              <p className={`mt-2 flex gap-2 rounded-xl p-2 text-sm ${open.risk.level === 'high' ? 'bg-miss-bg text-miss-fg' : 'bg-hurry-bg text-hurry-fg'}`}>
                <WarnIcon className="mt-0.5 shrink-0" />
                <span>
                  {RISK_LABEL[open.risk.level]}: {open.risk.transfers.filter((t) => t.level === open.risk.level).map(describeTransfer).join('; ')}. {open.risk.transfers.some((t) => t.usuallyLateS > 0)
                    ? 'Includes how late these rides usually run.'
                    : 'Based on live data only (no history yet).'}
                </span>
              </p>
            ) : null}
            {safer ? (
              <button type="button" onClick={() => setOpenId(safer.id)} className="bg-surface-2 text-text mt-2 w-full rounded-xl p-3 text-left text-sm font-semibold">
                Safer: arrive {clock(safer.end)} ({Math.round((safer.end - open.end) / 60_000)} min later) with {RISK_LABEL[safer.risk.level].toLowerCase()}. Show it
              </button>
            ) : null}
          </section>
          {tripAlerts.length > 0 ? (
            <section aria-label="Alerts on this trip" className="bg-surface rounded-xl p-4 pt-1">
              <AlertList alerts={tripAlerts} stepFree={stepFree} />
            </section>
          ) : null}
          <Suspense fallback={<div className="bg-surface h-56 rounded-xl" />}>
            <TripMap option={open} />
          </Suspense>
          <ol className="bg-surface rounded-xl p-4" aria-label="Steps">
            {open.legs.map((leg, i) => (
              <div key={i}>
                <LegView leg={leg} next={open.legs[i + 1]} transfer={notes.get(i)} onMissed={leg.transit ? () => void whatIfMissed(open, i) : undefined} />
                {missed?.legIndex === i ? (
                  <p role="status" className="bg-surface-2 -mt-3 mb-4 ml-11 rounded-xl p-2 text-sm">
                    {missed.text}
                  </p>
                ) : null}
              </div>
            ))}
            <li className="flex gap-3">
              <span className="flex w-8 justify-center" aria-hidden>
                <span className="bg-brand size-4 rounded-full" />
              </span>
              <p className="font-bold">
                Arrive at {open.legs[open.legs.length - 1]!.to.name} <span className="tabular">{clock(open.end)}</span>
              </p>
            </li>
          </ol>
          <p className="text-muted pb-20 text-xs">Times marked Live are MBTA predictions; Scheduled times are not live. Walking times assume about {pace === 'normal' ? '2.8' : pace === 'slow' ? '2.1' : '3.5'} mph.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader title="Trips" />
      <main className="pb-tabbar mx-auto max-w-xl space-y-4 px-4 pt-2">
        {inProgress ? (
          <button type="button" onClick={() => navigate('/go')} className="bg-brand text-on-brand shadow-float flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-4 text-left">
            <span>
              <span className="block font-extrabold">Trip in progress</span>
              <span className="block text-sm">To {inProgress.to.name}</span>
            </span>
            <span className="font-extrabold">Resume</span>
          </button>
        ) : null}
        <section aria-label="Plan a trip" className="bg-surface space-y-3 rounded-xl p-4">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-3">
              <PlaceField label="From" value={from} onChange={setFrom} here={here} onUseHere={() => useHere(setFrom)} />
              <PlaceField label="To" value={to} onChange={setTo} here={here} onUseHere={() => useHere(setTo)} autoFocus={searchParam(path, 'focus') === 'to'} />
            </div>
            <button
              type="button"
              aria-label="Swap from and to"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
              className="bg-surface-2 mb-8 flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <SwapIcon />
            </button>
          </div>
          {(from?.isHere || to?.isHere) && !here ? (
            <p className="text-muted text-sm">{location.kind === 'denied' ? 'Location is off for this site; choose a place instead.' : 'Finding your location…'}</p>
          ) : null}
          <fieldset>
            <legend className="text-muted mb-1 text-sm font-semibold">When</legend>
            <div className="bg-surface-2 grid grid-cols-3 gap-1 rounded-xl p-1">
              {(
                [
                  ['now', 'Leave now'],
                  ['leave', 'Leave at'],
                  ['arrive', 'Arrive by'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="relative">
                  <input type="radio" name="when" value={v} checked={timeMode === v} onChange={() => setTimeMode(v)} className="peer absolute inset-0 cursor-pointer opacity-0" />
                  <span className="peer-checked:bg-brand peer-checked:text-on-brand peer-focus-visible:outline-focus flex min-h-11 items-center justify-center rounded-lg text-sm font-bold peer-focus-visible:outline-3">{label}</span>
                </label>
              ))}
            </div>
            {timeMode !== 'now' ? (
              <label className="mt-2 block">
                <span className="visually-hidden">{timeMode === 'leave' ? 'Leave at' : 'Arrive by'} (Boston time)</span>
                <input type="datetime-local" value={localTime} onChange={(e) => setLocalTime(e.target.value)} className="bg-surface-2 min-h-11 w-full rounded-xl px-3" />
              </label>
            ) : null}
          </fieldset>
          <StepFreeSwitch checked={stepFree} onChange={setStepFree} />
        </section>

        {input ? (
          <div role="group" aria-label="Sort trips" className="no-scrollbar edge-fade -mx-4 flex gap-2 overflow-x-auto px-4">
            {SORTS.map((s) => (
              <FilterChip key={s.value} active={sort === s.value} onClick={() => setSort(s.value)}>
                {s.label}
              </FilterChip>
            ))}
          </div>
        ) : (
          <p className="text-muted px-1 text-sm">Choose where you're starting and where you're going.</p>
        )}

        <div role="status" aria-live="polite" className="space-y-3">
          {state === 'loading' ? <p className="text-muted">Planning…</p> : null}
          {state === 'error' ? <p className="bg-warn-bg text-warn-fg rounded-xl p-3 text-sm">{error}</p> : null}
          {state === 'idle' && plan
            ? plan.messages.map((m) => (
                <p key={m} className={options.length > 0 ? 'bg-surface-2 rounded-xl p-3 text-sm' : 'text-muted'}>
                  {m}
                </p>
              ))
            : null}
          {state === 'idle' && plan && !plan.live ? <p className="bg-warn-bg text-warn-fg rounded-xl p-3 text-sm">Live data is unavailable, so these trips use scheduled times.</p> : null}
        </div>

        {state !== 'error' && options.length > 0 ? (
          <section aria-label="Trips" className="space-y-3">
            {options.map((o, i) => (
              <TripCard
                key={o.id}
                option={o}
                onOpen={() => setOpenId(o.id)}
                tag={i === 0 ? (o.walkOnly ? 'Walk it' : SORTS.find((s) => s.value === sort)!.label) : o.walkOnly ? 'Walk it' : undefined}
              />
            ))}
          </section>
        ) : null}
        <p className="text-muted text-xs">Address search by Photon, using OpenStreetMap data. Routes by OpenTripPlanner.</p>
      </main>
    </>
  );
}
