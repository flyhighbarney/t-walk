// Learned walking pace: opt-in, measured on walks you navigate, kept on this
// device. It sets navigation ETAs directly; for planning, pick the nearest pace.

import { WALK_SPEED, type WalkPace } from '@twalk/core';
import { useLearnPace, useLearnedSpeed, useWalkPace } from '../lib/storage.ts';

const mph = (ms: number) => (ms * 2.23694).toFixed(1);

export function nearestPace(speed: number): WalkPace {
  return (Object.keys(WALK_SPEED) as WalkPace[]).reduce((best, p) => (Math.abs(WALK_SPEED[p] - speed) < Math.abs(WALK_SPEED[best] - speed) ? p : best), 'normal');
}

export function PaceSection() {
  const [learn, setLearn] = useLearnPace();
  const [learned, setLearned] = useLearnedSpeed();
  const [pace, setPace] = useWalkPace();
  const suggested = learned != null ? nearestPace(learned) : null;
  return (
    <section aria-labelledby="pace-h" className="space-y-2">
      {/* Heading above the card, like the other sections on Saved. */}
      <h2 id="pace-h" className="text-lg font-bold">
        Walking pace
      </h2>
      <div className="bg-surface space-y-3 rounded-2xl p-4">
      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <span className="flex-1">
          <span className="block font-bold">Learn it from my walks</span>
          <span className="text-muted block text-sm">While you navigate a walk, T-Walk times it. Only the average speed is kept, on this device.</span>
        </span>
        <input type="checkbox" role="switch" checked={learn} onChange={(e) => setLearn(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden
          className="peer-checked:bg-brand bg-surface-3 peer-focus-visible:outline-focus relative h-8 w-14 shrink-0 rounded-full peer-focus-visible:outline-3 after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-6"
        />
      </label>
      {learned != null ? (
        <div className="bg-surface-2 flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm">
          <p className="flex-1">
            Measured: about <strong>{mph(learned)} mph</strong>, including waits at crossings. Navigation uses it for arrival times.
          </p>
          {suggested && suggested !== pace ? (
            <button type="button" onClick={() => setPace(suggested)} className="bg-brand text-on-brand min-h-11 rounded-full px-4 font-bold">
              Plan with {suggested}
            </button>
          ) : null}
          <button type="button" onClick={() => setLearned(null)} className="text-brand-text min-h-11 px-2 font-bold underline">
            Forget it
          </button>
        </div>
      ) : learn ? (
        <p className="text-muted text-sm">Nothing measured yet. It needs about a quarter mile of walking with a good GPS signal.</p>
      ) : null}
      </div>
    </section>
  );
}
