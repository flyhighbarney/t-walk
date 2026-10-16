// The National Weather Service hourly forecast (api.weather.gov, free, no key;
// it asks for a User-Agent with contact details). Used to give a little more
// time when walking in rain or snow, and to say so.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface HourWeather {
  start: number;
  tempF: number;
  precipChance: number;
  short: string;
}

export interface WeatherAdvice {
  /** Extra minutes to leave earlier. */
  extraMin: number;
  /** "Rain likely: 2 min extra." */
  note: string | null;
}

export function adviceFor(h: HourWeather | null): WeatherAdvice {
  if (!h) return { extraMin: 0, note: null };
  const snow = /snow|sleet|ice|freezing/i.test(h.short);
  const rain = /rain|showers|storm|drizzle/i.test(h.short) || h.precipChance >= 50;
  if (snow) return { extraMin: 4, note: `${h.short}: 4 min extra for slower walking.` };
  if (rain) return { extraMin: 2, note: `${h.short.match(/storm/i) ? 'Storms' : 'Rain'} likely (${h.precipChance}%): 2 min extra.` };
  if (h.tempF <= 15) return { extraMin: 0, note: `Very cold (${h.tempF}°F): dress for the wait.` };
  if (h.tempF >= 92) return { extraMin: 0, note: `Very hot (${h.tempF}°F): bring water.` };
  return { extraMin: 0, note: null };
}

export class Weather {
  private grids = new Map<string, { url: string; at: number }>();
  private hourly = new Map<string, { at: number; hours: HourWeather[] }>();
  private readonly userAgent: string;
  private readonly fetch: Fetch;

  constructor(opts: { userAgent: string; fetch?: Fetch }) {
    this.userAgent = opts.userAgent;
    this.fetch = opts.fetch ?? fetch;
  }

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetch(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/geo+json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`NWS HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** The forecast hour covering `at` near a point, or null if the forecast can't be had. */
  async at(lat: number, lon: number, at: number): Promise<HourWeather | null> {
    try {
      // Points map to a forecast grid; the mapping changes rarely, so it's kept a day.
      const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      let grid = this.grids.get(key);
      if (!grid || Date.now() - grid.at > 86_400_000) {
        const p = await this.get<{ properties: { forecastHourly: string } }>(`https://api.weather.gov/points/${key}`);
        grid = { url: p.properties.forecastHourly, at: Date.now() };
        this.grids.set(key, grid);
      }
      let fc = this.hourly.get(grid.url);
      if (!fc || Date.now() - fc.at > 30 * 60_000) {
        const f = await this.get<{ properties: { periods: { startTime: string; temperature: number; probabilityOfPrecipitation?: { value: number | null }; shortForecast: string }[] } }>(grid.url);
        fc = {
          at: Date.now(),
          hours: f.properties.periods.map((p) => ({ start: Date.parse(p.startTime), tempF: p.temperature, precipChance: p.probabilityOfPrecipitation?.value ?? 0, short: p.shortForecast })),
        };
        this.hourly.set(grid.url, fc);
      }
      return [...fc.hours].reverse().find((h) => h.start <= at) ?? fc.hours[0] ?? null;
    } catch {
      return null;
    }
  }
}
