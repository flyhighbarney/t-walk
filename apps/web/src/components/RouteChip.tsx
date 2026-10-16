import type { RouteInfo } from '@twalk/core';

// Official line colours, with whichever of black or white text reads better on
// them: the MBTA's own white-on-orange is about 2.6:1, below WCAG AA.
function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function chipColors(route: RouteInfo): { background: string; color: string } {
  const bg = /^[0-9a-f]{6}$/i.test(route.color) ? route.color : '666666';
  const L = luminance(bg);
  return { background: `#${bg}`, color: contrast(L, 1) >= contrast(L, 0) ? '#ffffff' : '#000000' };
}

/** "Red", "1", "CR", "SL5"… */
export function routeLabel(route: RouteInfo): string {
  if (route.shortName) return route.shortName;
  if (route.mode === 'commuter_rail') return 'CR';
  if (route.mode === 'ferry') return 'Ferry';
  if (route.id.startsWith('Green-')) return `Green ${route.id.slice(6)}`;
  return route.longName.replace(/ Line$/, '');
}

export function routeName(route: RouteInfo): string {
  if (route.mode === 'bus') return `Route ${route.shortName || route.id}`;
  if (route.id.startsWith('Green-')) return `Green Line ${route.id.slice(6)} branch`;
  return route.longName;
}

export function RouteChip({ route }: { route: RouteInfo }) {
  return (
    <span
      className="inline-flex min-w-11 items-center justify-center rounded-md px-1.5 py-0.5 text-sm font-bold leading-tight"
      style={chipColors(route)}
      aria-hidden
    >
      {routeLabel(route)}
    </span>
  );
}
