// One source of "now" for everything on the server, so a replay can move time.

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A clock you set by hand (tests). */
export class ManualClock implements Clock {
  private t: number;
  constructor(t: number) {
    this.t = t;
  }
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Starts at `start` and runs at `speed`× real time (replays). */
export class OffsetClock implements Clock {
  private readonly realStart = Date.now();
  private readonly start: number;
  private readonly speed: number;
  constructor(start: number, speed = 1) {
    this.start = start;
    this.speed = speed;
  }
  now(): number {
    return this.start + (Date.now() - this.realStart) * this.speed;
  }
}
