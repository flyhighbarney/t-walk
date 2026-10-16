// The device's location, only while the page is open and visible, and only
// after the person has said yes. Nothing here runs in the background.

import { useEffect, useState } from 'react';
import { haversineMeters } from '@twalk/core';
import { usePageVisible } from './live.ts';

export type LocationState =
  | { kind: 'off' }
  | { kind: 'locating' }
  | { kind: 'denied' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'ok'; lat: number; lon: number; accuracy: number };

/** Re-query nearby stops only after moving this far. */
const MOVE_THRESHOLD_M = 75;

export function useLocation(enabled: boolean): LocationState {
  const visible = usePageVisible();
  const [state, setState] = useState<LocationState>({ kind: enabled ? 'locating' : 'off' });

  useEffect(() => {
    if (!enabled) {
      setState({ kind: 'off' });
      return;
    }
    if (!('geolocation' in navigator)) {
      setState({ kind: 'unavailable', message: "This browser can't share your location." });
      return;
    }
    if (!visible) return;
    setState((s) => (s.kind === 'ok' ? s : { kind: 'locating' }));
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        setState((prev) =>
          prev.kind === 'ok' && haversineMeters(prev.lat, prev.lon, lat, lon) < MOVE_THRESHOLD_M ? prev : { kind: 'ok', lat, lon, accuracy },
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState({ kind: 'denied' });
        else setState((prev) => (prev.kind === 'ok' ? prev : { kind: 'unavailable', message: "Couldn't find your location." }));
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, visible]);

  return state;
}
