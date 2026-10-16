// One line at the top saying how trustworthy the times below are, when they
// aren't fully live. Silent when everything is fine.

import { formatAge, type LiveStatus } from '@twalk/core';
import type { Connection } from '../lib/live.ts';
import { WarnIcon } from './icons.tsx';

export function StatusBanner({
  status,
  connection,
  lastMessageAt,
  offline,
}: {
  status: LiveStatus | null;
  connection: Connection;
  lastMessageAt: number | null;
  /** Boards are coming from the timetable kept on this device, saved at this time. */
  offline?: { savedAt: number | null } | null;
}) {
  let tone: 'down' | 'warn' | null = null;
  let message = '';

  const preds = status ? Object.values(status.predictions) : [];
  const allDown = preds.length > 0 && preds.every((h) => h.state === 'down');
  const someDown = preds.some((h) => h.state === 'down');
  const backup = preds.find((h) => h.detail?.includes('backup'));

  if (offline) {
    tone = 'warn';
    message = offline.savedAt
      ? `You're offline. Showing the timetable saved at ${new Date(offline.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}: scheduled times, not live.`
      : "You're offline, and no timetable is saved on this device yet. Open T-Walk once with a connection.";
  } else if (connection === 'lost') {
    tone = 'warn';
    const age = lastMessageAt ? (Date.now() - lastMessageAt) / 1000 : null;
    message = `No connection to T-Walk. Times may be out of date${age != null ? ` (${formatAge(age)})` : ''}. Reconnecting…`;
  } else if (allDown) {
    tone = 'down';
    message = 'Live arrival data is unavailable right now. Times shown are from the schedule.';
  } else if (someDown) {
    tone = 'warn';
    message = 'Live data is unavailable for some lines; those show scheduled times.';
  } else if (backup) {
    tone = 'warn';
    message = "The MBTA's live stream is interrupted. Using its backup feed, which updates less often.";
  }

  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {tone ? (
        <p
          className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-medium ${tone === 'down' ? 'bg-down-bg text-down-fg' : 'bg-warn-bg text-warn-fg'}`}
        >
          <WarnIcon className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
