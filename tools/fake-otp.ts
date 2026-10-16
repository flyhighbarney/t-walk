// A stand-in for OpenTripPlanner and Photon, for end-to-end tests and for
// trying the Trips screen without building a graph:
//
//   node tools/fake-otp.ts [port]    then   OTP_URL=http://127.0.0.1:8792 PHOTON_URL=http://127.0.0.1:8792/api/ npm start
//
// /otp/gtfs/v1 answers every plan with fixtures/otp/plan.json, its times moved
// so the trip starts when it was asked for. /api/ answers like Photon.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.argv[2] ?? process.env.PORT ?? 8792);
const fixture = readFileSync(join(import.meta.dirname, '../fixtures/otp/plan.json'), 'utf8');
const FIXTURE_START = Date.parse('2026-10-15T08:00:00-04:00');

const iso = (ms: number) => {
  // Keep Boston's offset in the strings, as OTP does.
  const d = new Date(ms - 4 * 3600_000);
  return `${d.toISOString().slice(0, 19)}-04:00`;
};

const PLACES = [
  { name: 'Harvard Square', street: 'Massachusetts Avenue', city: 'Cambridge', lat: 42.3732, lon: -71.1189 },
  { name: 'Boston Common', street: 'Tremont Street', city: 'Boston', lat: 42.3551, lon: -71.0656 },
];

createServer((req, res) => {
  if (req.url?.startsWith('/otp/gtfs/v1') && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const vars = (JSON.parse(body) as { variables?: { dateTime?: { earliestDeparture?: string; latestArrival?: string } } }).variables;
      const asked = Date.parse(vars?.dateTime?.earliestDeparture ?? vars?.dateTime?.latestArrival ?? new Date(FIXTURE_START).toISOString());
      const shift = asked - FIXTURE_START;
      const out = fixture.replace(/"(2026-10-15T\d\d:\d\d:\d\d-04:00)"/g, (_, t: string) => `"${iso(Date.parse(t) + shift)}"`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out);
    });
    return;
  }
  if (req.url?.startsWith('/api/')) {
    const q = new URL(req.url, 'http://x').searchParams.get('q')?.toLowerCase() ?? '';
    const features = PLACES.filter((p) => p.name.toLowerCase().includes(q)).map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { osm_id: i + 1, osm_type: 'N', name: p.name, street: p.street, city: p.city },
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'FeatureCollection', features }));
    return;
  }
  res.writeHead(404).end();
}).listen(port, '127.0.0.1', () => console.log(`fake OTP + Photon on http://127.0.0.1:${port}`));
