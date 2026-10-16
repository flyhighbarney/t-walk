// A trip's fare: each ride's single-ride price (from the MBTA's own fare
// tables, via OpenTripPlanner) combined with transfer rules from a
// configurable table (config/fares.json), keyed by the MBTA's route_fare_class.
//
// Why not take OTP's total: the MBTA encodes subway↔bus transfers with fare
// media rules (an extension to GTFS Fares v2) that OTP 2.10 doesn't apply, so
// subway-then-bus came out as two full fares.

import type { TripFare } from './trip.ts';

export interface FareRules {
  transferWindowMinutes: number;
  transfers: { from: string; to: string; pay: 'nothing' | 'difference' | 'full' }[];
  /** Classes that never get a transfer discount (each ride is paid in full). */
  noTransferDiscount: string[];
}

export interface FareLeg {
  fareClass: string | null;
  /** Single-ride price in cents, or null if unknown. */
  priceCents: number | null;
  /** When the ride starts, epoch ms. */
  start: number;
}

export function tripFare(legs: readonly FareLeg[], rules: FareRules): TripFare {
  if (legs.length === 0) return { cents: 0, label: 'Free (walking)' };
  let total = 0;
  let unknown = false;
  // The fare currently "open": what's been paid on it, and since when.
  let open: { cls: string; paid: number; since: number } | null = null;
  const windowMs = rules.transferWindowMinutes * 60_000;

  for (const leg of legs) {
    if (leg.priceCents == null || leg.fareClass == null) {
      unknown = true;
      open = null;
      continue;
    }
    const cls = leg.fareClass;
    const price = leg.priceCents;
    const rule =
      open && !rules.noTransferDiscount.includes(cls) && !rules.noTransferDiscount.includes(open.cls) && leg.start - open.since <= windowMs
        ? rules.transfers.find((t) => t.from === open!.cls && t.to === cls)
        : undefined;
    if (!open || !rule || rule.pay === 'full') {
      total += price;
      open = { cls, paid: price, since: leg.start };
    } else if (rule.pay === 'difference') {
      const extra = Math.max(0, price - open.paid);
      total += extra;
      // Having paid up to this ride's price, the fare now counts as this class.
      open = { cls, paid: open.paid + extra, since: open.since };
    }
    // 'nothing': the open fare covers this ride as it is.
  }
  return unknown
    ? { cents: null, label: 'Fare unknown for part of this trip' }
    : { cents: total, label: 'Tap to pay or CharlieCard' };
}
