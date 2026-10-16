// Navigation, Apple Maps / Google Maps style, for walking and transit:
// a banner with what to do next, a map that follows you, and a sheet with
// when you'll arrive. Walks are turn by turn; at the stop it shows the live
// departure and how far away the vehicle is; on board it counts your stops
// from the vehicle's live reports (no GPS needed underground) and says
// "Your stop is next" and "Get off" in time.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  WALK_SPEED,
  blendSpeed,
  formatClock,
  formatDistance,
  formatMinutes,
  learnedSpeed,
  lineTitle,
  navigate as navigateTrip,
  type Maneuver,
  type NavFix,
  type NavState,
  type RideLive,
  type TripLive,
} from '@twalk/core';
import { LocateIcon, ListIcon, WarnIcon } from '../../components/icons.tsx';
import { serverNow, useNow } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { useLearnPace, useLearnedSpeed, useLocationOptIn, useWalkPace } from '../../lib/storage.ts';
import {
  endShare,
  loadGo,
  saveGo,
  shareLink,
  startShare,
  useCompass,
  useNavFix,
  useShareSync,
  useTripLive,
  useWakeLock,
  type GoSession,
} from '../../lib/navigation.ts';
import { readable } from '../trips/TripParts.tsx';

const GoMap = lazy(() => import('./GoMap.tsx'));

const clock = (ms: number) => formatClock(ms).full;


function ManeuverIcon({ m, className }: { m: Maneuver; className?: string }) {
  const paths: Partial<Record<Maneuver, string>> = {
    straight: 'M12 21V4 M6 10l6-6 6 6',
    depart: 'M12 21V4 M6 10l6-6 6 6',
    left: 'M17 21v-8a4 4 0 0 0-4-4H5 M9 4 4 9l5 5',
    right: 'M7 21v-8a4 4 0 0 1 4-4h8 M15 4l5 5-5 5',
    'slight-left': 'M15 21v-7L8 6 M7 12V6h6',
    'slight-right': 'M9 21v-7l7-8 M17 12V6h-6',
    uturn: 'M8 21V9a5 5 0 0 1 10 0v5 M14 11l4 4 4-4',
    enter: 'M4 21h16 M7 21V9l5-5 5 5v12 M10 15h4',
    exit: 'M4 21h16 M7 21V9l5-5 5 5v12 M12 18v-6 M9.5 14.5 12 12l2.5 2.5',
    elevator: 'M6 3h12v18H6z M9 9l3-3 3 3 M9 15l3 3 3-3',
    board: 'M7 3h10a3 3 0 0 1 3 3v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z M4 11h16 M8 21l1.5-4 M16 21l-1.5-4',
    ride: 'M7 3h10a3 3 0 0 1 3 3v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z M4 11h16 M8 21l1.5-4 M16 21l-1.5-4',
    alight: 'M5 12h11 M12 7l5 5-5 5 M20 4v16',
    arrive: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  };
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" className={className} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[m] ?? paths.straight} />
    </svg>
  );
}

/** The short line shared with someone following your ETA. */
function shareStatus(s: NavState, session: GoSession): string {
  const leg = session.option.legs[s.legIndex]!;
  if (s.phase === 'arrived') return `Arrived at ${session.to.name}`;
  if (s.phase === 'walk') return `Walking to ${leg.to.name}`;
  if (s.phase === 'wait') return `Waiting for ${lineTitle(leg)} at ${leg.from.name}`;
  return `On ${lineTitle(leg)}${s.stopsLeft != null ? `, ${s.stopsLeft} stop${s.stopsLeft === 1 ? '' : 's'} to go` : ` to ${leg.to.name}`}`;
}

function toRideLive(t: TripLive | null): RideLive | null {
  if (!t) return null;
  const v = t.vehicle;
  return {
    vehicle: v ? { lat: v.latitude, lon: v.longitude, stopId: v.stopId, currentStatus: v.currentStatus, updatedAt: v.updatedAt } : null,
    stops: t.stops.filter((s) => !s.canceled).map((s) => ({ stopId: s.stopId, name: s.name, arrivalTime: s.arrivalTime, departureTime: s.departureTime })),
  };
}

export default function GoScreen() {
  const [session, setSession] = useState<GoSession | null>(() => loadGo(serverNow()));
  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-serif text-2xl font-bold">No trip in progress</h1>
        <p className="text-muted">Plan a trip, open the one you want and tap Start. T-Walk then guides you there, step by step.</p>
        <button type="button" onClick={() => navigate('/trips', { replace: true })} className="bg-brand text-on-brand min-h-12 rounded-full px-6 font-bold">
          Plan a trip
        </button>
      </main>
    );
  }
  return (
    <Navigator
      session={session}
      onChange={(s) => {
        saveGo(s);
        setSession(s);
      }}
    />
  );
}

function Navigator({ session, onChange }: { session: GoSession; onChange: (s: GoSession | null) => void }) {
  const { option } = session;
  const now = useNow();
  const [optIn, setOptIn] = useLocationOptIn();
  const fixState = useNavFix(optIn);
  const compass = useCompass();
  const [pace] = useWalkPace();
  const [learn] = useLearnPace();
  const [learned, setLearned] = useLearnedSpeed();
  const [follow, setFollow] = useState(true);
  const [showSteps, setShowSteps] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const speed = learned ?? WALK_SPEED[pace];
  useWakeLock(true);

  const fix: NavFix | null = fixState.kind === 'ok' ? fixState.fix : null;
  const idx = session.progress.legIndex;
  const cur = option.legs[idx]!;
  const pollLeg = cur.transit ? cur : option.legs[idx + 1]?.transit ? option.legs[idx + 1]! : null;

  // First pass without the faster polling decision, to know if your stop is close.
  const [fast, setFast] = useState(false);
  const { live } = useTripLive(pollLeg?.tripId ?? null, fast);
  const rideLive = useMemo(() => toRideLive(live), [live]);

  const { state, progress } = useMemo(
    () => navigateTrip({ option, progress: session.progress, fix, live: rideLive, now, speed }),
    [option, session.progress, fix, rideLive, now, speed],
  );
  useEffect(() => setFast(state.phase === 'ride' && state.stopsLeft != null && state.stopsLeft <= 2), [state.phase, state.stopsLeft]);

  // Keep progress (survives a reload); learn pace from each finished walk.
  const walkFixes = useRef<NavFix[]>([]);
  useEffect(() => {
    if (state.phase === 'walk' && fix && walkFixes.current[walkFixes.current.length - 1]?.at !== fix.at) walkFixes.current.push(fix);
  }, [state.phase, fix]);
  useEffect(() => {
    const p = session.progress;
    if (p.legIndex === progress.legIndex && p.onBoard === progress.onBoard && p.arrived === progress.arrived) return;
    if (learn && !option.legs[p.legIndex]!.transit) {
      const s = learnedSpeed(walkFixes.current);
      if (s != null) setLearned(blendSpeed(learned, s));
    }
    walkFixes.current = [];
    onChange({ ...session, progress });
  }, [progress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Your stop: buzz and, if T-Walk is in the background with notifications allowed, notify.
  const lastAlight = useRef(state.alight);
  useEffect(() => {
    if (state.alight === lastAlight.current) return;
    lastAlight.current = state.alight;
    if (state.alight === 'none') return;
    navigator.vibrate?.(state.alight === 'now' ? [300, 120, 300, 120, 300] : [200, 100, 200]);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      void navigator.serviceWorker?.ready.then((r) => r.showNotification(state.primary, { body: state.secondary ?? '', tag: 'twalk-nav', renotify: true } as NotificationOptions));
    }
  }, [state.alight, state.primary, state.secondary]);

  // Shared ETA.
  const status = shareStatus(state, session);
  useShareSync(session.share, state.eta, status, state.phase === 'arrived');

  const share = async () => {
    try {
      const s = session.share ?? (await startShare(session.to.name, state.eta, status));
      if (!session.share) onChange({ ...session, share: s, progress });
      const url = shareLink(s.id);
      const text = `I'm on my way to ${session.to.name}. Expected about ${clock(state.eta)}.`;
      if (navigator.share) await navigator.share({ title: 'My T-Walk ETA', text, url }).catch(() => {});
      else {
        await navigator.clipboard?.writeText(`${text} ${url}`);
        setToast('Link copied. Anyone with it sees your ETA, not your location.');
      }
    } catch {
      setToast("Couldn't start sharing. Check your connection.");
    }
  };
  const stopSharing = () => {
    if (session.share) endShare(session.share);
    onChange({ ...session, share: null, progress });
    setToast('Stopped sharing your ETA.');
  };
  const end = () => {
    if (session.share) endShare(session.share);
    onChange(null);
    navigate('/trips', { replace: true });
  };
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Off the route for a while: offer to re-plan from here.
  const offSince = useRef<number | null>(null);
  if (state.offRoute) offSince.current ??= now;
  else offSince.current = null;
  const replanHref =
    fix != null
      ? `/trips?from=${fix.lat.toFixed(5)},${fix.lon.toFixed(5)}&fromName=${encodeURIComponent('My location')}&to=${session.to.lat},${session.to.lon}&toName=${encodeURIComponent(session.to.name)}`
      : null;
  const showReplan = (state.late || (offSince.current != null && now - offSince.current > 20_000)) && replanHref;

  const heading = compass.heading ?? (fixState.kind === 'ok' ? fixState.course : null);
  const v = live?.vehicle ?? null;
  const vehicleView = v && pollLeg ? { lat: v.latitude, lon: v.longitude, label: v.label ? `${pollLeg.routeLabel ?? ''} ${v.label}`.trim() : (pollLeg.routeLabel ?? ''), ...colorsOf(pollLeg.color), stale: now - v.updatedAt > 90_000 } : null;
  const bannerStyle = state.phase === 'walk' || state.phase === 'arrived' ? { background: '#12b76a', color: '#00210e' } : readableStyle(cur.color);
  const minsLeft = Math.max(0, Math.round((state.eta - now) / 60_000));
  const liveRide = live?.stops.some((s) => s.stopId === cur.to.stopId || s.stopId === cur.from.stopId) ?? false;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <Suspense fallback={<div className="bg-surface absolute inset-0" />}>
        <GoMap
          option={option}
          legIndex={state.legIndex}
          phase={state.phase}
          position={state.position}
          heading={heading}
          vehicle={vehicleView}
          follow={follow}
          onUserMove={() => setFollow(false)}
          padding={{ top: 170, bottom: 230 }}
        />
      </Suspense>

      {/* Banner: what to do next. Read out when it changes. */}
      <header className="absolute inset-x-3 top-3 z-20" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className={`shadow-float rounded-2xl p-4 ${state.alight === 'now' ? 'animate-pulse' : ''}`} style={bannerStyle}>
          <div className="flex items-center gap-3" aria-live={state.alight === 'none' ? 'polite' : 'assertive'} aria-atomic="true">
            <ManeuverIcon m={state.maneuver} className="shrink-0" />
            <div className="min-w-0 flex-1">
              {state.distanceM != null ? <p className="tabular font-mono text-3xl leading-none font-bold">{formatDistance(state.distanceM)}</p> : null}
              <p className={`${state.distanceM != null ? 'mt-1 text-lg' : 'text-2xl'} leading-tight font-extrabold`}>{state.primary}</p>
              {state.secondary ? <p className="mt-0.5 text-sm font-semibold opacity-90">{state.secondary}</p> : null}
            </div>
          </div>
        </div>
        {state.phase === 'wait' ? <WaitCard state={state} now={now} live={liveRide} hasVehicle={v != null} /> : null}
        {state.phase === 'ride' && state.position?.source === 'vehicle' ? (
          <p className="bg-surface-2 shadow-float mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold">Following the train's live position (no GPS needed)</p>
        ) : null}
      </header>

      {/* Map controls */}
      <div className="absolute right-3 z-20 flex flex-col gap-2" style={{ bottom: 250 }}>
        {compass.needsPermission && navigator.maxTouchPoints > 0 ? (
          <button type="button" onClick={compass.request} className="bg-surface-2 shadow-float min-h-12 rounded-full px-4 text-sm font-bold">
            Use compass
          </button>
        ) : null}
        {!follow ? (
          <button type="button" onClick={() => setFollow(true)} className="bg-surface-2 shadow-float text-brand-text flex min-h-12 items-center gap-2 rounded-full px-4 font-bold">
            <LocateIcon /> Re-center
          </button>
        ) : null}
      </div>

      {/* Sheet: arrival, and what you can do */}
      <section aria-label="Trip progress" className="bg-surface shadow-float absolute inset-x-0 bottom-0 z-20 rounded-t-2xl px-4 pt-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <span className="bg-line mx-auto mb-3 block h-1.5 w-10 rounded-full" aria-hidden />
        {fixState.kind !== 'ok' && state.phase !== 'ride' ? <LocationNote kind={fixState.kind} onTurnOn={() => setOptIn(true)} /> : null}
        {showReplan ? (
          <a
            href={replanHref!}
            onClick={(e) => {
              e.preventDefault();
              navigate(replanHref!);
            }}
            className="bg-hurry-bg text-hurry-fg mb-3 flex items-center gap-2 rounded-xl p-3 text-sm font-bold"
          >
            <WarnIcon className="shrink-0" />
            {state.late ? `At this pace you'd miss it. Re-plan from here` : `You're off the route. Re-plan from here`}
          </a>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="tabular font-mono text-3xl font-bold">{state.phase === 'arrived' ? clock(now) : clock(state.eta)}</p>
            <p className="text-muted text-sm">
              {state.phase === 'arrived' ? `Arrived at ${session.to.name}` : `Arrive in ${formatMinutes(minsLeft).text} · ${formatDistance(state.remainingM)} to go`}
              {state.phase !== 'arrived' && pollLeg ? (liveRide ? ' · Live' : ' · Scheduled') : ''}
            </p>
          </div>
          {state.phase === 'arrived' ? (
            <button type="button" onClick={end} className="bg-brand text-on-brand min-h-12 rounded-full px-6 font-bold">
              Done
            </button>
          ) : (
            <button type="button" onClick={end} className="bg-surface-2 text-text min-h-12 rounded-full px-6 font-bold">
              End
            </button>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          {state.phase === 'wait' ? (
            <button type="button" onClick={() => onChange({ ...session, progress: { ...progress, onBoard: true } })} className="bg-brand text-on-brand min-h-11 flex-1 rounded-full px-3 text-sm font-bold">
              I'm on board
            </button>
          ) : null}
          {state.phase === 'ride' ? (
            <button
              type="button"
              onClick={() => onChange({ ...session, progress: progress.legIndex === option.legs.length - 1 ? { ...progress, arrived: true } : { legIndex: progress.legIndex + 1, onBoard: false, arrived: false } })}
              className="bg-surface-2 min-h-11 flex-1 rounded-full px-3 text-sm font-bold"
            >
              I got off
            </button>
          ) : null}
          {state.phase !== 'arrived' ? (
            session.share ? (
              <button type="button" onClick={stopSharing} className="bg-surface-2 min-h-11 flex-1 rounded-full px-3 text-sm font-bold">
                Stop sharing
              </button>
            ) : (
              <button type="button" onClick={() => void share()} className="bg-surface-2 min-h-11 flex-1 rounded-full px-3 text-sm font-bold">
                Share ETA
              </button>
            )
          ) : null}
          <button type="button" aria-expanded={showSteps} onClick={() => setShowSteps(!showSteps)} className="bg-surface-2 flex min-h-11 items-center justify-center gap-1 rounded-full px-4 text-sm font-bold">
            <ListIcon /> Steps
          </button>
        </div>
        {showSteps ? <Steps session={session} legIndex={state.legIndex} /> : null}
        <p role="status" aria-live="polite" className="empty:hidden mt-2 text-sm">
          {toast}
        </p>
      </section>
    </div>
  );
}

function colorsOf(hex: string | null) {
  const r = readable(hex);
  return { color: r.background, textColor: r.color };
}
const readableStyle = (hex: string | null) => readable(hex);

function WaitCard({ state, now, live, hasVehicle }: { state: NavState; now: number; live: boolean; hasVehicle: boolean }) {
  if (state.departsAt == null) return null;
  const mins = Math.round((state.departsAt - now) / 60_000);
  return (
    <div className="bg-surface shadow-float mt-2 rounded-xl p-3" role="status" aria-live="polite">
      <p className="font-bold">
        Leaves <span className="tabular">{clock(state.departsAt)}</span>
        <span className="text-muted font-normal"> · {mins <= 0 ? 'now' : `in ${formatMinutes(mins).text}`}</span>
        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${live ? 'bg-ok-bg text-ok-fg' : 'bg-surface-2 text-muted'}`}>{live ? 'Live' : 'Scheduled'}</span>
      </p>
      {state.vehicleStopsAway != null ? (
        <p className="text-muted text-sm">
          {state.vehicleStopsAway === 0 ? "It's at your stop" : state.vehicleStopsAway === 1 ? 'Your stop is its next one' : `It's ${state.vehicleStopsAway - 1} stop${state.vehicleStopsAway === 2 ? '' : 's'} away`}
        </p>
      ) : hasVehicle ? null : (
        <p className="text-muted text-sm">Not tracking this vehicle yet. It shows up once it starts its trip.</p>
      )}
    </div>
  );
}

function LocationNote({ kind, onTurnOn }: { kind: 'off' | 'locating' | 'denied' | 'unavailable'; onTurnOn: () => void }) {
  if (kind === 'locating') return <p className="text-muted mb-3 text-sm">Finding your location…</p>;
  return (
    <div className="bg-surface-2 mb-3 flex items-center gap-3 rounded-xl p-3 text-sm">
      <span className="flex-1">
        {kind === 'off'
          ? 'Turn on location for turn-by-turn walking directions.'
          : kind === 'denied'
            ? "Location is off for this site, so walking turns can't follow you. Rides still count your stops from the vehicle."
            : "Can't find your location right now."}
      </span>
      {kind === 'off' ? (
        <button type="button" onClick={onTurnOn} className="bg-brand text-on-brand min-h-11 shrink-0 rounded-full px-4 font-bold">
          Turn on
        </button>
      ) : null}
    </div>
  );
}

function Steps({ session, legIndex }: { session: GoSession; legIndex: number }) {
  return (
    <ol className="no-scrollbar mt-3 max-h-[40dvh] space-y-2 overflow-y-auto" aria-label="All steps">
      {session.option.legs.map((l, i) => (
        <li key={i} className={`rounded-xl p-3 ${i === legIndex ? 'bg-surface-2' : ''} ${i < legIndex ? 'text-muted' : ''}`} aria-current={i === legIndex ? 'step' : undefined}>
          <p className="font-bold">
            {l.transit ? `${lineTitle(l).replace(/^the /, '')}${l.headsign ? ` toward ${l.headsign}` : ''}` : `Walk to ${l.to.name}`}
            <span className="text-muted tabular font-normal"> · {clock(l.start.estimated ?? l.start.scheduled)}</span>
          </p>
          <p className="text-muted text-sm">
            {l.transit ? `${l.from.name} → ${l.to.name}, ${l.stopsBetween + 1} stop${l.stopsBetween === 0 ? '' : 's'}` : `${formatDistance(l.distanceM)} · about ${Math.max(1, Math.round(l.durationS / 60))} min`}
          </p>
          {!l.transit && i === legIndex && l.steps.length ? (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {l.steps.slice(0, 8).map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

