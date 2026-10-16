import { describe, expect, it } from 'vitest';
import { parseSseChunk } from './sse.ts';
import { alertFromV3, predictionFromV3, vehicleFromV3 } from './v3.ts';
import { feedTimestamp, predictionId, predictionsFromTripUpdates, vehiclesFromFeed } from './gtfsrt.ts';
import { LiveStore } from './store.ts';

describe('SSE parsing', () => {
  it('splits events, joins multi-line data and keeps the unfinished tail', () => {
    const got: [string, string][] = [];
    const tail = parseSseChunk('event: reset\ndata: [1,\ndata: 2]\n\n: keep-alive\n\nevent: update\ndata: {"a"', (e, d) =>
      got.push([e, d]),
    );
    expect(got).toEqual([['reset', '[1,\n2]']]);
    expect(tail).toBe('event: update\ndata: {"a"');
    parseSseChunk(`${tail}:1}\r\n\r\n`, (e, d) => got.push([e, d]));
    expect(got[1]).toEqual(['update', '{"a":1}']);
  });
});

// Shapes copied from live responses on 2026-10-15.
const livePrediction = {
  attributes: {
    arrival_time: null,
    arrival_uncertainty: null,
    departure_time: null,
    departure_uncertainty: null,
    direction_id: 1,
    last_trip: false,
    revenue: 'REVENUE',
    schedule_relationship: 'CANCELLED',
    status: null,
    stop_sequence: 600,
    trip_headsign: null,
    update_type: null,
  },
  id: 'prediction-77745322-70200-600-Green-D',
  relationships: {
    route: { data: { id: 'Green-D', type: 'route' } },
    stop: { data: { id: '70200', type: 'stop' } },
    trip: { data: { id: '77745322', type: 'trip' } },
    vehicle: { data: null },
  },
  type: 'prediction',
};

describe('V3 adapter', () => {
  it('reads a prediction and normalizes CANCELLED', () => {
    expect(predictionFromV3(livePrediction)).toMatchObject({
      id: 'prediction-77745322-70200-600-Green-D',
      tripId: '77745322',
      routeId: 'Green-D',
      stopId: '70200',
      directionId: 1,
      stopSequence: 600,
      scheduleRelationship: 'CANCELED',
      vehicleId: null,
      revenue: true,
    });
  });

  it('reads times, uncertainty and the update type', () => {
    const p = predictionFromV3({
      ...livePrediction,
      attributes: {
        ...livePrediction.attributes,
        departure_time: '2026-10-15T22:41:29-04:00',
        departure_uncertainty: 360,
        status: 'Stopped 1 stop away',
        update_type: 'REVERSE_TRIP',
        schedule_relationship: null,
        revenue: 'NON_REVENUE',
      },
    });
    expect(p).toMatchObject({
      departureTime: Date.parse('2026-10-16T02:41:29Z'),
      departureUncertainty: 360,
      status: 'Stopped 1 stop away',
      updateType: 'REVERSE_TRIP',
      scheduleRelationship: null,
      revenue: false,
    });
  });

  it('reads a vehicle with carriages', () => {
    const v = vehicleFromV3({
      id: 'R-548C37DD',
      type: 'vehicle',
      attributes: {
        bearing: 145,
        carriages: [{ label: '1879', occupancy_status: 'NO_DATA_AVAILABLE', occupancy_percentage: null }],
        current_status: 'INCOMING_AT',
        current_stop_sequence: 120,
        direction_id: 0,
        label: '1879',
        latitude: 42.32269,
        longitude: -71.05279,
        occupancy_status: null,
        revenue: 'REVENUE',
        speed: null,
        updated_at: '2026-10-15T22:41:27-04:00',
      },
      relationships: {
        route: { data: { id: 'Red', type: 'route' } },
        stop: { data: { id: '70095', type: 'stop' } },
        trip: { data: { id: 'ADDED-1584998974', type: 'trip' } },
      },
    });
    expect(v).toMatchObject({ currentStatus: 'INCOMING_AT', tripId: 'ADDED-1584998974', stopId: '70095', carriages: [{ label: '1879' }] });
  });

  it('reads an alert', () => {
    const a = alertFromV3({
      id: '1037492',
      type: 'alert',
      attributes: {
        active_period: [{ end: '2026-11-01T03:00:00-05:00', start: '2026-10-07T18:23:00-04:00' }],
        cause: 'UNKNOWN_CAUSE',
        effect: 'SERVICE_CHANGE',
        header: 'F8 Winthrop/Quincy Ferry weekend service has ended for the season.',
        informed_entity: [{ route_type: 4, route: 'Boat-F8', activities: ['BOARD', 'EXIT', 'RIDE'] }],
        lifecycle: 'ONGOING',
        severity: 3,
        timeframe: 'through October 31',
        updated_at: '2026-10-13T06:35:31-04:00',
      },
    });
    expect(a).toMatchObject({ effect: 'SERVICE_CHANGE', severity: 3, entities: [{ route: 'Boat-F8', routeType: 4 }] });
    expect(a?.activePeriods[0]?.end).toBe(Date.parse('2026-11-01T08:00:00Z'));
  });
});

describe('GTFS-realtime adapter', () => {
  const feed = JSON.stringify({
    header: { timestamp: 1792118485, gtfs_realtime_version: '2.0', incrementality: 'FULL_DATASET' },
    entity: [
      {
        id: 'FBWMLConstruction-859932-886',
        trip_update: {
          timestamp: 1792118469,
          stop_time_update: [
            { stop_id: 'NEC-2040-02', stop_sequence: 30, arrival: { time: 1792118598 }, departure: { time: 1792118648 } },
            { stop_id: 'NEC-2287', stop_sequence: 100, arrival: { time: 1792120981 } },
          ],
          trip: { trip_id: 'FBWMLConstruction-859932-886', route_id: 'CR-Providence', direction_id: 1, revenue: true, last_trip: false },
          vehicle: { id: '1864', label: '1864' },
        },
      },
      {
        id: 'x',
        trip_update: {
          update_type: 'reverse_trip',
          stop_time_update: [{ stop_id: '70237', stop_sequence: 440, arrival: { time: 1792116259, uncertainty: 60 }, boarding_status: 'Stopped at station' }],
          trip: { trip_id: 'T2', route_id: 'Red', schedule_relationship: 'CANCELED' },
        },
      },
    ],
  });

  it('reads the header timestamp without parsing the feed', () => {
    expect(feedTimestamp(feed)).toBe(1792118485000);
  });

  it('turns stop time updates into predictions with V3-compatible ids', () => {
    const ps = predictionsFromTripUpdates(feed);
    expect(ps).toHaveLength(3);
    expect(ps[1]).toMatchObject({
      id: predictionId('FBWMLConstruction-859932-886', 'NEC-2287', 100, 'CR-Providence'),
      departureTime: null, // last stop: can't board
      arrivalTime: 1792120981000,
      vehicleId: '1864',
      directionId: 1,
    });
    expect(ps[2]).toMatchObject({ scheduleRelationship: 'CANCELED', status: 'Stopped at station', updateType: 'REVERSE_TRIP', arrivalUncertainty: 60 });
  });

  it('reads vehicle positions', () => {
    const vs = vehiclesFromFeed(
      JSON.stringify({
        header: { timestamp: 1 },
        entity: [
          {
            id: 'O-548C263F',
            vehicle: {
              current_status: 'STOPPED_AT',
              position: { bearing: 25, latitude: 42.31682, longitude: -71.10443 },
              stop_id: '70005',
              timestamp: 1792118442,
              trip: { trip_id: 'ADDED-1584999063', route_id: 'Orange', direction_id: 1, revenue: true },
              vehicle: { id: 'O-548C263F', label: '1430' },
            },
          },
        ],
      }),
    );
    expect(vs[0]).toMatchObject({ id: 'O-548C263F', label: '1430', currentStatus: 'STOPPED_AT', updatedAt: 1792118442000 });
  });
});

describe('store', () => {
  it('replaces only the resetting stream’s items and keeps its indexes right', () => {
    const store = new LiveStore();
    const p = (id: string, stopId: string) => predictionFromV3({ ...livePrediction, id, relationships: { ...livePrediction.relationships, stop: { data: { id: stopId, type: 'stop' } } } })!;
    store.predictions.reset('predictions-rail', [p('a', 'S1'), p('b', 'S2')]);
    store.predictions.reset('predictions-bus', [p('c', 'S1')]);
    store.predictions.reset('predictions-rail', [p('d', 'S2')]);
    expect([...store.predictions.items.keys()].sort()).toEqual(['c', 'd']);
    expect(store.predictionsAtStops(['S1']).map((x) => x.id)).toEqual(['c']);
    // Moving stops updates the index.
    store.predictions.set('predictions-bus', p('c', 'S3'));
    expect(store.predictionsAtStops(['S1'])).toEqual([]);
    expect(store.predictionsAtStops(['S3']).map((x) => x.id)).toEqual(['c']);
  });
});
