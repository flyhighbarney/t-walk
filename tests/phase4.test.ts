// Alerts (V3 replay and the public GTFS-realtime feed) and the offline pack.

import { describe, expect, it } from 'vitest';
import type { AlertView, OfflinePack } from '@twalk/core';
import { alertsFromFeed, feedTimestamp } from '../apps/server/src/live/gtfsrt.ts';
import { stack } from './helpers.ts';

const T0 = Date.parse('2026-10-15T08:00:00-04:00');

describe('/api/alerts', () => {
  it("gives a stop its line's alerts, and its elevator outage only in step-free mode", async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const get = async (q: string) => (await s.app.inject({ url: `/api/alerts?${q}` })).json() as { byStop: Record<string, AlertView[]> };
    const plain = await get('stops=place-pktrm,B1');
    expect(plain.byStop['place-pktrm']!.map((a) => a.kind)).toEqual(['delay']);
    expect(plain.byStop['place-pktrm']![0]).toMatchObject({ when: 'Until 9:59 AM', upcoming: false });
    // Route 1 only: no Red Line alert at the bus stop.
    expect(plain.byStop.B1).toEqual([]);
    const stepFree = await get('stops=70075&stepFree=1');
    expect(stepFree.byStop['place-pktrm']!.map((a) => a.kind).sort()).toEqual(['delay', 'elevator']);
  });

  it('gives a trip one list for its stops and lines', async () => {
    const s = await stack({ scenario: 'normal', start: T0 });
    const r = (await s.app.inject({ url: '/api/alerts?trip=1&stops=B1&routes=Red,1' })).json() as { alerts: AlertView[] };
    expect(r.alerts.map((a) => a.id)).toEqual(['fx-delay']);
  });
});

describe('feed timestamp', () => {
  it("reads the header's, wherever the header is", () => {
    const vehicle = { id: 'y1', vehicle: { timestamp: 1792132571, position: { latitude: 42.2, longitude: -71.06 } } };
    // VehiclePositions_enhanced.json, as served 2026-10-16: entities first, header last.
    expect(feedTimestamp(JSON.stringify({ entity: [vehicle], header: { gtfs_realtime_version: '2.0', timestamp: 1792132835 } }))).toBe(1792132835000);
    expect(feedTimestamp(JSON.stringify({ header: { timestamp: 1792132835 }, entity: [vehicle] }))).toBe(1792132835000);
    const many = { entity: Array.from({ length: 50 }, () => vehicle), header: { timestamp: 1792132835 }, extra: 'x'.repeat(500) };
    expect(feedTimestamp(JSON.stringify(many))).toBe(1792132835000);
  });
});

describe('public alerts feed', () => {
  it('reads the enhanced GTFS-realtime alerts (shape seen live 2026-10-16)', () => {
    const [a] = alertsFromFeed(
      JSON.stringify({
        header: { timestamp: 1792130851 },
        entity: [
          {
            id: '670001',
            alert: {
              cause: 'UNKNOWN_CAUSE',
              effect: 'ACCESSIBILITY_ISSUE',
              effect_detail: 'ELEVATOR_CLOSURE',
              severity: 3,
              active_period: [{ start: 1784721137 }],
              informed_entity: [{ stop_id: 'place-WML-0442', route_id: 'CR-Worcester', route_type: 2, activities: ['USING_WHEELCHAIR'], facility_id: '782' }],
              header_text: { translation: [{ text: 'Worcester Elevator 782 is unavailable.', language: 'en' }] },
              alert_lifecycle: 'ONGOING',
              last_modified_timestamp: 1791403158,
            },
          },
        ],
      }),
    );
    expect(a).toMatchObject({
      id: '670001',
      effect: 'ELEVATOR_CLOSURE',
      header: 'Worcester Elevator 782 is unavailable.',
      activePeriods: [{ start: 1784721137000, end: null }],
      entities: [{ stop: 'place-WML-0442', route: 'CR-Worcester', facility: '782', activities: ['USING_WHEELCHAIR'] }],
    });
  });
});

describe('/api/offline/pack', () => {
  it('packs a day of timetable for the stops asked for', async () => {
    const s = await stack({ start: T0 });
    const pack = (await s.app.inject({ url: '/api/offline/pack?stops=70075,B1,nope' })).json() as OfflinePack;
    expect(pack.stops.map((x) => x.id)).toEqual(['place-pktrm', 'B1']);
    expect(pack.stops[0]!.platforms.sort()).toEqual(['70075', '70076']);
    expect(pack.schedules['place-pktrm']!.map((x) => x.tripId)).toEqual(['R-0802', 'R-0810', 'R-0818', 'R-0827']);
    // B0 is where the bus starts; B1 is its last stop, where riders get off, and the late trip is past midnight.
    expect(pack.schedules.B1!.map((x) => x.tripId).sort()).toEqual(['B-0750', 'B-0805', 'B-0820', 'B-LATE']);
    expect(pack.routes.map((r) => r.id).sort()).toEqual(['1', 'Red']);
    expect(pack.until - pack.generatedAt).toBe(24 * 3600_000);
  });
});
