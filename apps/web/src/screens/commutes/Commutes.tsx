// Saved commutes (in the Saved tab): a card per commute with today's plan and
// "Leave by", alerts on its lines, and the leave-now notification switch.

import { useEffect, useId, useState } from 'react';
import {
  WEEKDAYS,
  describeDays,
  formatClock,
  nextOccurrence,
  type Commute,
  type PlanResponse,
  type TripOption,
} from '@twalk/core';
import { AlertList, useTripAlerts } from '../../components/Alerts.tsx';
import { NowIcon, WarnIcon } from '../../components/icons.tsx';
import { StepFreeSwitch } from '../../components/StepFreeSwitch.tsx';
import { serverNow, useNow, usePageVisible } from '../../lib/live.ts';
import { disablePush, enablePush, pushSupport, testPush, updatePush } from '../../lib/push.ts';
import { navigate } from '../../lib/router.ts';
import { useCommutes, useStepFree, useWalkPace } from '../../lib/storage.ts';
import { PlaceField } from '../trips/PlaceField.tsx';
import { LegChip, RiskBadge, SourceTag } from '../trips/TripParts.tsx';
import { fetchPlan, type Place } from '../trips/tripsApi.ts';

const DAY_LETTERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "08:15" → "8:15 AM". */
function clock12(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
/** Plans are shown from this long before a commute (further out, live data can't help). */
const PLAN_AHEAD_MS = 3 * 3600_000;

function dayName(date: string, today: string): string {
  if (date === today) return 'Today';
  const d = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

function useCommutePlan(c: Commute, pace: string): { option: TripOption | null; at: number | null; state: 'later' | 'loading' | 'ok' | 'none' | 'error' } {
  const visible = usePageVisible();
  const [result, setResult] = useState<{ option: TripOption | null; state: 'loading' | 'ok' | 'none' | 'error' }>({ option: null, state: 'loading' });
  // Ticks every second (and as soon as the server's clock is known), so "soon" follows real time.
  const now = useNow();
  const occ = nextOccurrence(c, now);
  const soon = occ != null && occ.at - now <= PLAN_AHEAD_MS;
  const key = `${JSON.stringify(c)}|${occ?.at}|${pace}|${soon}`;
  useEffect(() => {
    if (!occ || !soon || !visible) return;
    const ac = new AbortController();
    const p = new URLSearchParams({
      from: `${c.from.lat},${c.from.lon}`,
      to: `${c.to.lat},${c.to.lon}`,
      fromName: c.from.name,
      toName: c.to.name,
      time: new Date(occ.at).toISOString(),
      pace,
      sort: 'fastest',
    });
    if (c.mode === 'arrive') p.set('arriveBy', '1');
    if (c.stepFree) p.set('stepFree', '1');
    const load = () =>
      fetchPlan(`/api/plan?${p.toString()}`, ac.signal)
        .then((r: PlanResponse) => {
          const option = r.options.find((o) => o.start >= serverNow() - 60_000) ?? null;
          setResult({ option, state: option ? 'ok' : 'none' });
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setResult({ option: null, state: 'error' });
        });
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      ac.abort();
      window.clearInterval(t);
    };
  }, [key, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!occ) return { option: null, at: null, state: 'none' };
  return soon ? { ...result, at: occ.at } : { option: null, at: occ.at, state: 'later' };
}

function CommuteCard({ c, onEdit }: { c: Commute; onEdit: () => void }) {
  const { remove, serverIds, setServerId, save } = useCommutes();
  const [pace] = useWalkPace();
  const plan = useCommutePlan(c, pace);
  const serverId = serverIds[c.id] ?? null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rides = plan.option?.legs.filter((l) => l.transit) ?? [];
  const alerts = useTripAlerts(
    rides.flatMap((l) => [l.from.stopId, l.to.stopId]).filter((s): s is string => !!s),
    rides.map((l) => l.routeId).filter((r): r is string => !!r),
    c.stepFree,
  );
  const occ = nextOccurrence(c, serverNow());
  const today = new Date(serverNow()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replaceAll('-', '');
  const support = pushSupport();
  const headingId = useId();

  const toggleNotify = async (on: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      if (on) {
        const id = await enablePush(c);
        setServerId(c.id, id);
        save({ ...c, notify: true });
        await testPush(id);
        setNote('Notifications are on. A test message is on its way.');
      } else if (serverId) {
        await disablePush(serverId).catch(() => {});
        setServerId(c.id, null);
        save({ ...c, notify: false });
        setNote('Notifications are off; this commute is no longer on the server.');
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article id={c.id} aria-labelledby={headingId} className="bg-surface rounded-2xl p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-xl font-extrabold break-words">
            {c.name}
          </h3>
          <p className="text-muted text-sm">
            {c.from.name} → {c.to.name}
          </p>
          <p className="text-muted text-sm">
            {describeDays(c.days)} · {c.mode === 'arrive' ? 'arrive by' : 'leave at'} {clock12(c.time)}
            {c.stepFree ? ' · step-free' : ''}
          </p>
        </div>
        <button type="button" onClick={onEdit} className="bg-surface-2 min-h-11 shrink-0 rounded-full px-4 text-sm font-bold">
          Edit
        </button>
      </header>

      <div className="bg-surface-2 mt-3 rounded-xl p-3" aria-live="polite">
        {plan.state === 'later' && occ ? (
          <p className="text-sm">
            <span className="font-bold">Next: {dayName(occ.date, today)}</span>
            <span className="text-muted"> · the plan appears 3 hours before</span>
          </p>
        ) : null}
        {plan.state === 'loading' ? <p className="text-muted text-sm">Planning today's trip…</p> : null}
        {plan.state === 'error' ? <p className="text-muted text-sm">Couldn't plan right now; will try again.</p> : null}
        {plan.state === 'none' ? <p className="text-muted text-sm">No trip found for the next time this runs.</p> : null}
        {plan.option ? (
          <>
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-extrabold">
                <NowIcon className="text-brand-text mr-1 inline size-5" />
                Leave by {formatClock(plan.option.start).full}
              </span>
              <span className="text-muted text-sm">arrive {formatClock(plan.option.end).full}</span>
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5">
              {plan.option.legs.map((l, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  {i > 0 ? <span className="text-muted">›</span> : null}
                  <LegChip leg={l} />
                </span>
              ))}
              {rides[0] ? <SourceTag source={rides[0].source} /> : null}
            </p>
            {plan.option.transfers > 0 ? (
              <p className="mt-2">
                <RiskBadge level={plan.option.risk.level} />
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      <AlertList alerts={alerts} stepFree={c.stepFree} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            role="switch"
            checked={!!serverId}
            disabled={busy || support !== 'ok'}
            onChange={(e) => void toggleNotify(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="peer-checked:bg-brand bg-surface-3 peer-focus-visible:outline-focus relative h-8 w-14 shrink-0 rounded-full peer-disabled:opacity-50 peer-focus-visible:outline-3 after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-6"
          />
          <span className="font-bold">Leave-now notifications</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate(`/trips?from=${c.from.lat},${c.from.lon}&fromName=${encodeURIComponent(c.from.name)}&to=${c.to.lat},${c.to.lon}&toName=${encodeURIComponent(c.to.name)}`)}
            className="text-brand-text min-h-11 text-sm font-bold"
          >
            Other routes
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Delete "${c.name}"?`)) return;
              if (serverId) void disablePush(serverId).catch(() => {});
              setServerId(c.id, null);
              remove(c.id);
            }}
            className="text-miss-text min-h-11 text-sm font-bold"
          >
            Delete
          </button>
        </div>
      </div>
      {support === 'ios-install' ? (
        <p className="text-muted mt-1 text-xs">On iPhone and iPad, notifications work once T-Walk is added to the Home Screen (Share → Add to Home Screen).</p>
      ) : null}
      {support === 'unsupported' ? <p className="text-muted mt-1 text-xs">This browser can't show notifications.</p> : null}
      {support === 'denied' ? <p className="text-muted mt-1 text-xs">Notifications are blocked for this site in your browser settings.</p> : null}
      {note ? (
        <p role="status" className="mt-1 text-sm">
          {note}
        </p>
      ) : null}
      {serverId ? (
        <p className="text-muted mt-1 text-xs">
          While notifications are on, the T-Walk server keeps this commute (its two places, time and days) to know when to tell you. Turning them off deletes it there.
        </p>
      ) : null}
      {serverId && c.notify ? <SyncToServer c={c} serverId={serverId} /> : null}
    </article>
  );
}

/** Keep the server's copy in step when the commute is edited. */
function SyncToServer({ c, serverId }: { c: Commute; serverId: string }) {
  const json = JSON.stringify(c);
  useEffect(() => {
    void updatePush(serverId, c).catch(() => {});
  }, [json]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function CommuteForm({ initial, onDone }: { initial: Commute | null; onDone: () => void }) {
  const { save } = useCommutes();
  const [stepFreePref] = useStepFree();
  const [name, setName] = useState(initial?.name ?? 'Work');
  const [from, setFrom] = useState<Place | null>(initial?.from ?? null);
  const [to, setTo] = useState<Place | null>(initial?.to ?? null);
  const [mode, setMode] = useState<Commute['mode']>(initial?.mode ?? 'arrive');
  const [time, setTime] = useState(initial?.time ?? '09:00');
  const [days, setDays] = useState<number[]>(initial?.days ?? WEEKDAYS);
  const [stepFree, setStepFree] = useState(initial?.stepFree ?? stepFreePref);
  const [error, setError] = useState('');
  const nameId = useId();

  const submit = () => {
    if (!from || !to) return setError('Choose where it starts and where it ends.');
    if (days.length === 0) return setError('Choose at least one day.');
    save({
      id: initial?.id ?? `c${Date.now().toString(36)}`,
      name: name.trim() || 'Commute',
      from: { name: from.name, lat: from.lat, lon: from.lon },
      to: { name: to.name, lat: to.lat, lon: to.lon },
      mode,
      time,
      days: [...days].sort(),
      stepFree,
      notify: initial?.notify ?? false,
    });
    onDone();
  };

  return (
    <section aria-label={initial ? 'Edit commute' : 'New commute'} className="bg-surface space-y-3 rounded-2xl p-4">
      <div>
        <label htmlFor={nameId} className="text-muted mb-1 block text-sm font-semibold">
          Name
        </label>
        <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="bg-surface-2 min-h-12 w-full rounded-xl px-3" />
      </div>
      <PlaceField label="From" value={from} onChange={setFrom} here={null} onUseHere={() => setError('Pick a fixed place for a commute (home, work…).')} />
      <PlaceField label="To" value={to} onChange={setTo} here={null} onUseHere={() => setError('Pick a fixed place for a commute (home, work…).')} />
      <fieldset>
        <legend className="text-muted mb-1 text-sm font-semibold">When</legend>
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-surface-2 grid grid-cols-2 gap-1 rounded-xl p-1">
            {(
              [
                ['arrive', 'Arrive by'],
                ['leave', 'Leave at'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="relative">
                <input type="radio" name="cmode" value={v} checked={mode === v} onChange={() => setMode(v)} className="peer absolute inset-0 cursor-pointer opacity-0" />
                <span className="peer-checked:bg-brand peer-checked:text-on-brand peer-focus-visible:outline-focus flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-bold peer-focus-visible:outline-3">{label}</span>
              </label>
            ))}
          </div>
          <label>
            <span className="visually-hidden">Time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="bg-surface-2 min-h-12 rounded-xl px-3" />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-muted mb-1 text-sm font-semibold">Days</legend>
        {/* Seven across, so no day wraps onto a line of its own. */}
        <div className="grid grid-cols-7 gap-1">
          {DAY_LETTERS.map((d, i) => (
            <label key={d} className="relative">
              <input
                type="checkbox"
                checked={days.includes(i)}
                onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((x) => x !== i))}
                className="peer absolute inset-0 cursor-pointer opacity-0"
              />
              <span className="peer-checked:bg-brand peer-checked:text-on-brand bg-surface-2 peer-focus-visible:outline-focus flex min-h-11 items-center justify-center rounded-full text-sm font-bold peer-focus-visible:outline-3">{d}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <StepFreeSwitch checked={stepFree} onChange={setStepFree} />
      {error ? (
        <p role="alert" className="text-miss-text flex items-center gap-1 text-sm">
          <WarnIcon /> {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" onClick={submit} className="bg-brand text-on-brand min-h-12 flex-1 rounded-full font-bold">
          Save commute
        </button>
        <button type="button" onClick={onDone} className="bg-surface-2 min-h-12 rounded-full px-5 font-bold">
          Cancel
        </button>
      </div>
    </section>
  );
}

export function CommutesSection() {
  const { commutes } = useCommutes();
  const [editing, setEditing] = useState<Commute | 'new' | null>(null);
  return (
    <section aria-labelledby="commutes-h" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="commutes-h" className="text-lg font-bold">
          Commutes
        </h2>
        {!editing ? (
          <button type="button" onClick={() => setEditing('new')} className="text-brand-text min-h-11 text-sm font-bold">
            + Add a commute
          </button>
        ) : null}
      </div>
      {editing ? <CommuteForm initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} /> : null}
      {commutes.length === 0 && !editing ? (
        <p className="bg-surface text-muted rounded-2xl p-4 text-sm">Save a trip you make often, like home to work, to see when to leave and get alerts that affect it.</p>
      ) : null}
      {commutes.filter((c) => editing === 'new' || editing === null || c.id !== (editing as Commute).id).map((c) => (
        <CommuteCard key={c.id} c={c} onEdit={() => setEditing(c)} />
      ))}
    </section>
  );
}
