// A sheet over the bottom of the map. Not modal (the map stays usable), but
// it takes focus when it opens, Escape closes it, and focus goes back to
// whatever opened it.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CloseIcon } from '../../components/icons.tsx';

export function BottomSheet(props: { title: ReactNode; label: string; onClose: () => void; children: ReactNode; header?: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const [tall, setTall] = useState(false);
  const { onClose } = props;

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-sheet={props.label}
      tabIndex={-1}
      className={`sheet-enter bg-surface shadow-float absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl outline-none ${tall ? 'h-[82%]' : 'max-h-[60%]'}`}
    >
      <button
        type="button"
        onClick={() => setTall((t) => !t)}
        aria-label={tall ? 'Make the panel smaller' : 'Make the panel taller'}
        aria-expanded={tall}
        className="flex h-6 w-full shrink-0 items-center justify-center"
      >
        <span className="bg-surface-3 block h-1.5 w-12 rounded-full" />
      </button>
      <div className="flex items-start justify-between gap-3 px-4 pb-2">
        <h2 id={titleId} className="font-serif min-w-0 text-2xl leading-tight font-bold break-words">
          {props.title}
        </h2>
        <div className="flex shrink-0 gap-2">
          {props.actions}
          <button type="button" onClick={props.onClose} aria-label="Close" className="bg-surface-2 flex size-11 items-center justify-center rounded-full">
            <CloseIcon />
          </button>
        </div>
      </div>
      {props.header}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{props.children}</div>
    </div>
  );
}
