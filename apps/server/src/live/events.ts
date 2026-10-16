// Everything that arrives from upstream, as one stream of events. The live
// sources produce these, the recorder writes them to disk exactly as received,
// and the replay harness feeds them back — so a replay exercises the same code
// path as the real thing, from parsing onwards.

export type StreamName =
  | 'predictions-rail'
  | 'predictions-bus'
  | 'vehicles'
  | 'alerts'
  | 'gtfsrt-trip-updates'
  | 'gtfsrt-vehicles';

export type UpstreamEvent =
  /** Connection established (SSE) or first successful poll. */
  | { t: number; stream: StreamName; kind: 'open' }
  /** Connection lost or poll failed; `reason` is for logs. */
  | { t: number; stream: StreamName; kind: 'close'; reason: string }
  /** SSE: `event` is reset/add/update/remove; GTFS-RT: `event` is "feed". `data` is the raw text. */
  | { t: number; stream: StreamName; kind: 'message'; event: string; data: string };

export type EventSink = (event: UpstreamEvent) => void;

export const PREDICTION_STREAMS: StreamName[] = ['predictions-rail', 'predictions-bus'];
