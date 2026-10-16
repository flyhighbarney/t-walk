// The shell: three tabs. The map (and MapLibre) loads only when it's opened,
// so the Now screen stays small and fast.

import { lazy, Suspense } from 'react';
import { TabBar } from './components/Shell.tsx';
import { tabOf, useLocationPath } from './lib/router.ts';
import NowScreen from './screens/NowScreen.tsx';
import SavedScreen from './screens/SavedScreen.tsx';

const MapScreen = lazy(() => import('./screens/map/MapScreen.tsx'));

export default function App() {
  const path = useLocationPath();
  const tab = tabOf(path);
  return (
    <>
      {tab === 'now' ? <NowScreen /> : null}
      {tab === 'saved' ? <SavedScreen /> : null}
      {tab === 'map' ? (
        <Suspense fallback={<p className="text-muted p-6 text-center">Loading the map…</p>}>
          <MapScreen path={path} />
        </Suspense>
      ) : null}
      <TabBar current={tab} />
    </>
  );
}
