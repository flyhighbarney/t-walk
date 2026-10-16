// The shell: four tabs, plus navigation and shared-ETA screens without them.
// The map (and MapLibre) loads only when it's opened, so the Now screen stays
// small and fast.

import { lazy, Suspense } from 'react';
import { TabBar } from './components/Shell.tsx';
import { tabOf, useLocationPath } from './lib/router.ts';
import NowScreen from './screens/NowScreen.tsx';
import SavedScreen from './screens/SavedScreen.tsx';

const MapScreen = lazy(() => import('./screens/map/MapScreen.tsx'));
const TripsScreen = lazy(() => import('./screens/trips/TripsScreen.tsx'));
const GoScreen = lazy(() => import('./screens/go/GoScreen.tsx'));
const ShareScreen = lazy(() => import('./screens/ShareScreen.tsx'));

export default function App() {
  const path = useLocationPath();
  const tab = tabOf(path);
  return (
    <>
      {tab === 'now' ? <NowScreen /> : null}
      {tab === 'saved' ? <SavedScreen /> : null}
      {tab === 'trips' ? (
        <Suspense fallback={<p className="text-muted p-6 text-center">Loading the trip planner…</p>}>
          <TripsScreen path={path} />
        </Suspense>
      ) : null}
      {tab === 'map' ? (
        <Suspense fallback={<p className="text-muted p-6 text-center">Loading the map…</p>}>
          <MapScreen path={path} />
        </Suspense>
      ) : null}
      {tab === 'go' ? (
        <Suspense fallback={<p className="text-muted p-6 text-center">Starting directions…</p>}>
          <GoScreen />
        </Suspense>
      ) : null}
      {tab === 'share' ? (
        <Suspense fallback={<p className="text-muted p-6 text-center">Loading…</p>}>
          <ShareScreen path={path} />
        </Suspense>
      ) : null}
      {tab === 'go' || tab === 'share' ? null : <TabBar current={tab} />}
    </>
  );
}
