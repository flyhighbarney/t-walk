// A from/to field: type to search stops, addresses and places, or pick "My location".

import { useEffect, useId, useRef, useState } from 'react';
import { CloseIcon, LocateIcon } from '../../components/icons.tsx';
import { searchPlaces, type Place, type PlaceResult } from './tripsApi.ts';

export function PlaceField(props: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  here: { lat: number; lon: number } | null;
  onUseHere: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [placesDown, setPlacesDown] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const { here } = props;

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      searchPlaces(q, here, ac.signal)
        .then((r) => {
          setResults(r.results);
          setPlacesDown(!r.placesAvailable);
          setActive(-1);
        })
        .catch(() => {});
    }, 300);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [q, open, here]);

  const pick = (p: Place) => {
    props.onChange(p);
    setQ('');
    setOpen(false);
  };
  const options: { key: string; label: string; detail: string; place: Place | null }[] = [
    { key: 'here', label: 'My location', detail: here ? 'Where you are now' : 'Asks to use your location', place: null },
    ...results.map((r) => ({ key: r.id, label: r.name, detail: r.detail, place: { name: r.name, detail: r.detail, lat: r.lat, lon: r.lon } })),
  ];
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.key === 'here') {
      props.onUseHere();
      setOpen(false);
      setQ('');
    } else if (o.place) pick(o.place);
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="text-muted mb-1 block text-xs font-bold tracking-widest uppercase">
        {props.label}
      </label>
      {props.value && !open ? (
        <div className="bg-surface-2 flex min-h-12 items-center gap-2 rounded-xl pr-1 pl-3">
          <button
            type="button"
            id={id}
            className="min-w-0 flex-1 py-2 text-left"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            <span className="flex items-center gap-1.5 font-bold">
              {props.value.isHere ? <LocateIcon className="text-brand-text size-4" /> : null}
              {props.value.name}
            </span>
            {props.value.detail ? <span className="text-muted block truncate text-xs">{props.value.detail}</span> : null}
          </button>
          <button type="button" aria-label={`Clear ${props.label.toLowerCase()}`} onClick={() => props.onChange(null)} className="flex size-10 items-center justify-center">
            <CloseIcon className="size-5" />
          </button>
        </div>
      ) : (
        <input
          ref={input}
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          value={q}
          placeholder="Address, place, stop, or station"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && active >= 0) {
              e.preventDefault();
              choose(active);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          className="bg-surface-2 placeholder:text-muted min-h-12 w-full rounded-xl px-3 text-base"
        />
      )}
      {open ? (
        <ul id={listId} role="listbox" aria-label={`${props.label} suggestions`} className="bg-surface-2 shadow-float divide-line absolute inset-x-0 top-full z-30 mt-1 max-h-80 divide-y overflow-y-auto rounded-xl">
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              className={`cursor-pointer px-3 py-2.5 ${i === active ? 'bg-surface-3' : ''}`}
            >
              <span className="flex items-center gap-1.5 font-bold">
                {o.key === 'here' ? <LocateIcon className="text-brand-text size-4" /> : null}
                {o.label}
              </span>
              {o.detail ? <span className="text-muted block text-xs">{o.detail}</span> : null}
            </li>
          ))}
          {placesDown ? <li className="text-muted px-3 py-2 text-xs">Address search is unavailable right now; stops and stations still work.</li> : null}
          {q.trim().length >= 2 && results.length === 0 && !placesDown ? <li className="text-muted px-3 py-2 text-xs">Searching…</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
