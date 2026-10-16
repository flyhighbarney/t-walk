import { describe, expect, it } from 'vitest';
import { describeDays, leaveMessage, nextOccurrence } from './commute.ts';
import type { TripOption } from './trip.ts';

const at = (iso: string) => Date.parse(iso);

describe('next occurrence', () => {
  const weekdays8 = { time: '08:15', days: [0, 1, 2, 3, 4] };

  it("is today's when it's still ahead", () => {
    // Fri 2026-10-16, 7:00 AM Boston.
    expect(nextOccurrence(weekdays8, at('2026-10-16T07:00:00-04:00'))).toEqual({ date: '20261016', at: at('2026-10-16T08:15:00-04:00') });
  });

  it('skips the weekend', () => {
    expect(nextOccurrence(weekdays8, at('2026-10-16T09:00:00-04:00'))?.date).toBe('20261019');
  });

  it('keeps today for a few minutes after the time (still under way)', () => {
    expect(nextOccurrence(weekdays8, at('2026-10-16T08:25:00-04:00'))?.date).toBe('20261016');
  });

  it('crosses the fall-back change at the right local time', () => {
    // Sunday 2026-11-01 is the DST change; Monday 8:15 is EST.
    expect(nextOccurrence(weekdays8, at('2026-10-31T12:00:00-04:00'))).toEqual({ date: '20261102', at: at('2026-11-02T08:15:00-05:00') });
  });

  it('has none without days', () => {
    expect(nextOccurrence({ time: '08:15', days: [] }, Date.now())).toBeNull();
  });
});

describe('wording', () => {
  it('names the days', () => {
    expect(describeDays([4, 0, 1, 2, 3])).toBe('Weekdays');
    expect(describeDays([5, 6])).toBe('Weekends');
    expect(describeDays([0, 2])).toBe('Mon, Wed');
  });

  it('writes the leave-now message', () => {
    const now = at('2026-10-16T08:06:00-04:00');
    const option = {
      start: at('2026-10-16T08:09:00-04:00'),
      end: at('2026-10-16T08:47:00-04:00'),
      legs: [
        { transit: false },
        {
          transit: true,
          mode: 'SUBWAY',
          routeName: 'Orange Line',
          routeLabel: 'Orange',
          source: 'live',
          from: { name: 'Back Bay' },
          start: { scheduled: at('2026-10-16T08:21:00-04:00'), estimated: null },
        },
      ],
    } as unknown as TripOption;
    expect(leaveMessage(option, now)).toEqual({
      title: 'Leave in 3 min to catch the 8:21 AM Orange Line',
      body: 'From Back Bay; arrive about 8:47 AM.',
      leaveAt: at('2026-10-16T08:09:00-04:00'),
    });
    const scheduled = { ...option, legs: [option.legs[0]!, { ...option.legs[1]!, source: 'scheduled' }] } as TripOption;
    expect(leaveMessage(scheduled, now, { weatherNote: 'Rain likely: 2 min extra.' }).body).toBe(
      'Time is scheduled. From Back Bay; arrive about 8:47 AM. Rain likely: 2 min extra.',
    );
  });
});
