// The SQLite tables the GTFS feed is imported into, and how each GTFS file maps
// onto them. Times are stored as seconds since the service day's zero point
// (see packages/core/src/time.ts), so 25:10:00 is 90600.

import { gtfsTimeToSeconds } from '@twalk/core';

/** Bump when the tables below change: older databases are re-imported. */
export const SCHEMA_VERSION = 2;

export const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE routes (
  route_id TEXT PRIMARY KEY, route_type INTEGER, short_name TEXT, long_name TEXT,
  color TEXT, text_color TEXT, sort_order INTEGER, listed INTEGER, fare_class TEXT
);
CREATE TABLE directions (route_id TEXT, direction_id INTEGER, direction TEXT, destination TEXT,
  PRIMARY KEY (route_id, direction_id));
CREATE TABLE stops (
  stop_id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, location_type INTEGER,
  parent_station TEXT, platform_code TEXT, platform_name TEXT, wheelchair_boarding INTEGER,
  vehicle_type INTEGER, municipality TEXT, level_id TEXT
);
CREATE TABLE trips (
  trip_id TEXT PRIMARY KEY, route_id TEXT, service_id TEXT, headsign TEXT, direction_id INTEGER,
  shape_id TEXT, wheelchair_accessible INTEGER, route_pattern_id TEXT
);
CREATE TABLE stop_times (
  trip_id TEXT, stop_id TEXT, stop_sequence INTEGER, arr INTEGER, dep INTEGER,
  stop_headsign TEXT, pickup_type INTEGER, drop_off_type INTEGER
);
CREATE TABLE calendar (service_id TEXT PRIMARY KEY, days TEXT, start_date TEXT, end_date TEXT);
CREATE TABLE calendar_dates (service_id TEXT, date TEXT, exception_type INTEGER);
CREATE TABLE transfers (
  from_stop_id TEXT, to_stop_id TEXT, transfer_type INTEGER, min_transfer_time INTEGER,
  min_walk_time INTEGER, min_wheelchair_time INTEGER, suggested_buffer_time INTEGER,
  wheelchair_transfer INTEGER, from_trip_id TEXT, to_trip_id TEXT
);
CREATE TABLE pathways (
  pathway_id TEXT PRIMARY KEY, from_stop_id TEXT, to_stop_id TEXT, facility_id TEXT,
  pathway_mode INTEGER, is_bidirectional INTEGER, length REAL, traversal_time INTEGER,
  wheelchair_traversal_time INTEGER, stair_count INTEGER, max_slope REAL, name TEXT,
  signposted_as TEXT, instructions TEXT
);
CREATE TABLE levels (level_id TEXT PRIMARY KEY, level_index REAL, level_name TEXT);
CREATE TABLE facilities (
  facility_id TEXT PRIMARY KEY, facility_type TEXT, stop_id TEXT, short_name TEXT,
  long_name TEXT, lat REAL, lon REAL, wheelchair_facility INTEGER
);
CREATE TABLE shapes (shape_id TEXT, seq INTEGER, lat REAL, lon REAL);
`;

/** Built after the files are loaded. */
export const POST_IMPORT = `
CREATE INDEX stop_times_by_stop ON stop_times (stop_id, dep);
CREATE INDEX stop_times_by_trip ON stop_times (trip_id, stop_sequence);
CREATE INDEX stops_by_parent ON stops (parent_station);
CREATE INDEX stops_by_lat ON stops (lat);
CREATE INDEX shapes_by_id ON shapes (shape_id, seq);
CREATE INDEX calendar_dates_by_date ON calendar_dates (date);

-- When each trip leaves its first stop.
CREATE TABLE trip_start AS
  SELECT trip_id, MIN(COALESCE(dep, arr)) AS start_secs FROM stop_times GROUP BY trip_id;
CREATE UNIQUE INDEX trip_start_pk ON trip_start (trip_id);

-- Routes serving each stop, at the level a rider picks: the station, or the bus stop itself.
CREATE TABLE stop_routes AS
  SELECT DISTINCT COALESCE(NULLIF(s.parent_station, ''), s.stop_id) AS stop_id, t.route_id
  FROM stop_times st JOIN trips t USING (trip_id) JOIN stops s ON s.stop_id = st.stop_id;
CREATE INDEX stop_routes_by_stop ON stop_routes (stop_id);
CREATE INDEX stop_routes_by_route ON stop_routes (route_id);
ANALYZE;
`;

type Row = Record<string, string | undefined>;
type Value = string | number | null;

const text = (v: string | undefined): string | null => (v == null || v === '' ? null : v);
const int = (v: string | undefined): number | null => (v == null || v.trim() === '' ? null : Number.parseInt(v, 10));
const num = (v: string | undefined): number | null => (v == null || v.trim() === '' ? null : Number(v));
const time = (v: string | undefined): number | null => (v == null || v.trim() === '' ? null : gtfsTimeToSeconds(v));

export interface FileSpec {
  file: string;
  table: string;
  required: boolean;
  columns: string[];
  map: (r: Row) => Value[];
}

export const FILES: FileSpec[] = [
  {
    file: 'feed_info.txt',
    table: 'meta',
    required: false,
    columns: ['key', 'value'],
    map: (r) => ['feed_version', text(r.feed_version)],
  },
  {
    file: 'routes.txt',
    table: 'routes',
    required: true,
    columns: ['route_id', 'route_type', 'short_name', 'long_name', 'color', 'text_color', 'sort_order', 'listed', 'fare_class'],
    map: (r) => [
      text(r.route_id),
      int(r.route_type),
      text(r.route_short_name) ?? '',
      text(r.route_long_name) ?? '',
      text(r.route_color) ?? '666666',
      text(r.route_text_color) ?? 'FFFFFF',
      int(r.route_sort_order) ?? 0,
      // MBTA: listed_route = 1 means "not listed" (shuttles, special routes).
      r.listed_route === '1' ? 0 : 1,
      text(r.route_fare_class),
    ],
  },
  {
    file: 'directions.txt',
    table: 'directions',
    required: false,
    columns: ['route_id', 'direction_id', 'direction', 'destination'],
    map: (r) => [text(r.route_id), int(r.direction_id), text(r.direction), text(r.direction_destination)],
  },
  {
    file: 'stops.txt',
    table: 'stops',
    required: true,
    columns: [
      'stop_id', 'name', 'lat', 'lon', 'location_type', 'parent_station', 'platform_code',
      'platform_name', 'wheelchair_boarding', 'vehicle_type', 'municipality', 'level_id',
    ],
    map: (r) => [
      text(r.stop_id),
      text(r.stop_name),
      num(r.stop_lat),
      num(r.stop_lon),
      int(r.location_type) ?? 0,
      text(r.parent_station),
      text(r.platform_code),
      text(r.platform_name),
      int(r.wheelchair_boarding) ?? 0,
      int(r.vehicle_type),
      text(r.municipality),
      text(r.level_id),
    ],
  },
  {
    file: 'trips.txt',
    table: 'trips',
    required: true,
    columns: ['trip_id', 'route_id', 'service_id', 'headsign', 'direction_id', 'shape_id', 'wheelchair_accessible', 'route_pattern_id'],
    map: (r) => [
      text(r.trip_id),
      text(r.route_id),
      text(r.service_id),
      text(r.trip_headsign) ?? '',
      int(r.direction_id) ?? 0,
      text(r.shape_id),
      int(r.wheelchair_accessible) ?? 0,
      text(r.route_pattern_id),
    ],
  },
  {
    file: 'stop_times.txt',
    table: 'stop_times',
    required: true,
    columns: ['trip_id', 'stop_id', 'stop_sequence', 'arr', 'dep', 'stop_headsign', 'pickup_type', 'drop_off_type'],
    map: (r) => [
      text(r.trip_id),
      text(r.stop_id),
      int(r.stop_sequence),
      time(r.arrival_time),
      time(r.departure_time),
      text(r.stop_headsign),
      int(r.pickup_type) ?? 0,
      int(r.drop_off_type) ?? 0,
    ],
  },
  {
    file: 'calendar.txt',
    table: 'calendar',
    required: false,
    columns: ['service_id', 'days', 'start_date', 'end_date'],
    map: (r) => [
      text(r.service_id),
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => (r[d] === '1' ? '1' : '0')).join(''),
      text(r.start_date),
      text(r.end_date),
    ],
  },
  {
    file: 'calendar_dates.txt',
    table: 'calendar_dates',
    required: false,
    columns: ['service_id', 'date', 'exception_type'],
    map: (r) => [text(r.service_id), text(r.date), int(r.exception_type)],
  },
  {
    file: 'transfers.txt',
    table: 'transfers',
    required: false,
    columns: [
      'from_stop_id', 'to_stop_id', 'transfer_type', 'min_transfer_time', 'min_walk_time',
      'min_wheelchair_time', 'suggested_buffer_time', 'wheelchair_transfer', 'from_trip_id', 'to_trip_id',
    ],
    map: (r) => [
      text(r.from_stop_id), text(r.to_stop_id), int(r.transfer_type), int(r.min_transfer_time),
      int(r.min_walk_time), int(r.min_wheelchair_time), int(r.suggested_buffer_time),
      int(r.wheelchair_transfer), text(r.from_trip_id), text(r.to_trip_id),
    ],
  },
  {
    file: 'pathways.txt',
    table: 'pathways',
    required: false,
    columns: [
      'pathway_id', 'from_stop_id', 'to_stop_id', 'facility_id', 'pathway_mode', 'is_bidirectional',
      'length', 'traversal_time', 'wheelchair_traversal_time', 'stair_count', 'max_slope', 'name',
      'signposted_as', 'instructions',
    ],
    map: (r) => [
      text(r.pathway_id), text(r.from_stop_id), text(r.to_stop_id), text(r.facility_id),
      int(r.pathway_mode), int(r.is_bidirectional), num(r.length), int(r.traversal_time),
      int(r.wheelchair_traversal_time), int(r.stair_count), num(r.max_slope), text(r.pathway_name),
      text(r.signposted_as), text(r.instructions),
    ],
  },
  {
    file: 'levels.txt',
    table: 'levels',
    required: false,
    columns: ['level_id', 'level_index', 'level_name'],
    map: (r) => [text(r.level_id), num(r.level_index), text(r.level_name)],
  },
  {
    file: 'facilities.txt',
    table: 'facilities',
    required: false,
    columns: ['facility_id', 'facility_type', 'stop_id', 'short_name', 'long_name', 'lat', 'lon', 'wheelchair_facility'],
    map: (r) => [
      text(r.facility_id), text(r.facility_type), text(r.stop_id), text(r.facility_short_name),
      text(r.facility_long_name), num(r.facility_lat), num(r.facility_lon), int(r.wheelchair_facility),
    ],
  },
  {
    file: 'shapes.txt',
    table: 'shapes',
    required: false,
    columns: ['shape_id', 'seq', 'lat', 'lon'],
    map: (r) => [text(r.shape_id), int(r.shape_pt_sequence), num(r.shape_pt_lat), num(r.shape_pt_lon)],
  },
];
