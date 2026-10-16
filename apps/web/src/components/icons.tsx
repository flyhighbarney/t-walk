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
