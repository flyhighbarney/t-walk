// Arrival history: how late a line really runs against what we told riders.
// Pure and storage-free; the server decides where samples come from and where
// they live. Transfer risk uses `extraBufferS` to widen its buffer for lines
// that have a track record of slipping.

export interface ArrivalSample {
  /** Seconds the vehicle arrived after the time shown (negative = early). */
  delayS: number;
  at: number;
}

export interface HistoryKey {
  routeId: string;
  stopId: string;
}

export const historyKey = (k: HistoryKey) => `${k.routeId}|${k.stopId}`;

/** Fewer samples than this and a percentile says nothing. */
export const MIN_SAMPLES = 8;
const MAX_SAMPLES = 200;
/** Never widen a buffer by more than this, whatever the history says. */
export const MAX_EXTRA_BUFFER_S = 5 * 60;

/** Nearest-rank percentile (p in 0..1) of an unsorted list; null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank]!;
}

export class ArrivalHistory {
  private readonly samples = new Map<string, ArrivalSample[]>();

  record(key: HistoryKey, sample: ArrivalSample): void {
    if (!Number.isFinite(sample.delayS)) return;
    const id = historyKey(key);
    const list = this.samples.get(id) ?? [];
    list.push(sample);
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
    this.samples.set(id, list);
  }

  count(key: HistoryKey): number {
    return this.samples.get(historyKey(key))?.length ?? 0;
  }

  /**
   * Extra seconds to add to a connection's buffer: the 80th-percentile delay,
   * clamped to 0..MAX_EXTRA_BUFFER_S. Null when there's too little history to say.
   */
  extraBufferS(key: HistoryKey): number | null {
    const list = this.samples.get(historyKey(key));
    if (!list || list.length < MIN_SAMPLES) return null;
    const p80 = percentile(list.map((s) => s.delayS), 0.8);
    return p80 == null ? null : Math.min(MAX_EXTRA_BUFFER_S, Math.max(0, Math.round(p80)));
  }

  /** Counts for debugging: how many route+stop pairs are tracked and how many have enough samples to widen a buffer. */
  summary(): { pairs: number; samples: number; usable: number } {
    let samples = 0;
    let usable = 0;
    for (const list of this.samples.values()) {
      samples += list.length;
      if (list.length >= MIN_SAMPLES) usable++;
    }
    return { pairs: this.samples.size, samples, usable };
  }

  toJSON(): Record<string, ArrivalSample[]> {
    return Object.fromEntries(this.samples);
  }

  static fromJSON(data: Record<string, ArrivalSample[]>): ArrivalHistory {
    const h = new ArrivalHistory();
    for (const [id, list] of Object.entries(data)) {
      if (Array.isArray(list)) h.samples.set(id, list.filter((s) => Number.isFinite(s?.delayS)).slice(-MAX_SAMPLES));
    }
    return h;
  }
}
