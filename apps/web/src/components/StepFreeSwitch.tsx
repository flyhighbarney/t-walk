// The step-free switch, the same on Trips and in the commute form.

import { WheelchairIcon } from './icons.tsx';

export function StepFreeSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3">
      <WheelchairIcon className="text-brand-text shrink-0" />
      <span className="flex-1">
        <span className="block font-bold">Step-free</span>
        <span className="text-muted block text-sm">Accessible stations and vehicles, elevators instead of stairs</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="peer-checked:bg-brand bg-surface-3 peer-focus-visible:outline-focus relative h-8 w-14 shrink-0 rounded-full peer-focus-visible:outline-3 after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white peer-checked:after:bg-on-brand after:transition-transform peer-checked:after:translate-x-6"
      />
    </label>
  );
}
