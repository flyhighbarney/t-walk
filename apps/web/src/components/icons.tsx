// Small inline icons (no icon library: keeps the first load small).
// Decorative: every icon sits next to words that say the same thing.

type P = { className?: string };
const base = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false } as const;

export const CheckIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5l3.2 3L13 4.5" />
  </svg>
);

export const HurryIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor">
    <path d="M9.2 1 3 9h4.2L6.6 15 13 6.8H8.7z" />
  </svg>
);

export const MissIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const WarnIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor">
    <path d="M8 1.5 15 14H1zM7.2 6v4h1.6V6zm0 5.2v1.6h1.6v-1.6z" />
  </svg>
);

export const ClockIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.5V8l2.4 1.6" />
  </svg>
);

export const WalkIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor">
    <circle cx="9" cy="2.4" r="1.6" />
    <path d="M7.4 5.2 5 6.6V9h1.4V7.4l1-.6-.9 4.4L4 14.4l1.1.9 2.7-3.2.6-2 1.5 1.6V15h1.4v-3.8L9.6 9.4l.4-2 .9 1.4H13V7.4h-1.4L10 5.2z" />
  </svg>
);

export const StarIcon = ({ filled, className }: P & { filled: boolean }) => (
  <svg {...base} width={20} height={20} className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
    <path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2l-3.9 2.2.9-4.3-3.3-3 4.4-.5z" />
  </svg>
);

export const VehicleIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor">
    <path d="M4 2h8a2 2 0 0 1 2 2v7a1.5 1.5 0 0 1-1 1.4V14h-1.6v-1.5H4.6V14H3v-1.6A1.5 1.5 0 0 1 2 11V4a2 2 0 0 1 2-2zm-.4 2.2v3.4h8.8V4.2zM4.6 9.4a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm6.8 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z" />
  </svg>
);

const big = { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const;
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const MapIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z M9 4v13.5 M15 6.5V20" />
  </svg>
);

export const NowIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const BookmarkIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />
  </svg>
);

export const LayersIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8z M3.5 12.5 12 17l8.5-4.5 M3.5 16.5 12 21l8.5-4.5" />
  </svg>
);

export const LocateIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <path d="M12 2.5v3 M12 18.5v3 M2.5 12h3 M18.5 12h3" />
  </svg>
);

export const SearchIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </svg>
);

export const CloseIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ListIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="M9 6.5h11 M9 12h11 M9 17.5h11 M4.5 6.5h.01 M4.5 12h.01 M4.5 17.5h.01" />
  </svg>
);

export const BikeIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <circle cx="6" cy="16" r="3.5" />
    <circle cx="18" cy="16" r="3.5" />
    <path d="M6 16 9.5 8.5h5L18 16 M9.5 8.5 12 16h0 M14 6h2.5" />
  </svg>
);

export const TrainIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <rect x="5.5" y="3.5" width="13" height="13" rx="3" />
    <path d="M5.5 10.5h13 M8.5 20.5l2-4 M15.5 20.5l-2-4" />
    <circle cx="9" cy="13.5" r=".6" fill="currentColor" />
    <circle cx="15" cy="13.5" r=".6" fill="currentColor" />
  </svg>
);

export const BusIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <rect x="4.5" y="3.5" width="15" height="14" rx="2.5" />
    <path d="M4.5 11h15 M7.5 17.5v3 M16.5 17.5v3" />
  </svg>
);

export const FerryIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="M3.5 17.5c2 1.5 3.5 1.5 5.5 0s3.5-1.5 5.5 0 3.5 1.5 5.5 0 M5 14l1.5-5h11L19 14 M9 9V5.5h6V9" />
  </svg>
);

export const PersonIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" />
  </svg>
);

export const RouteIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
  </svg>
);

export const SwapIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="M7 4v16 M3.5 7.5 7 4l3.5 3.5 M17 20V4 M13.5 16.5 17 20l3.5-3.5" />
  </svg>
);

export const WheelchairIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <circle cx="10" cy="4" r="1.6" />
    <path d="M10 7v6h6l2.5 5 M10 10h5 M8 10.5a5.5 5.5 0 1 0 7.5 7" />
  </svg>
);

export const ChevronIcon = ({ className }: P) => (
  <svg {...big} {...stroke} className={className}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);
