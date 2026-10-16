// Plans a handful of real trips through a running server (npm start + npm run otp:serve) and prints them.
// Drive /api/plan on the running server against real OTP.
const base = 'http://127.0.0.1:8787';
const at = '2026-10-16T12:00:00.000Z'; // 8:00 AM Boston
const cases: [string, string, string, string][] = [
  ['Park St → Harvard', '42.3564,-71.0624', '42.3734,-71.1189', ''],
  ['Back Bay → Kendall', '42.3473,-71.0757', '42.3625,-71.0862', ''],
  ['Nubian → Central', '42.3297,-71.0838', '42.3651,-71.1037', ''],
  ['South Sta → Worcester (CR)', '42.3523,-71.0552', '42.2618,-71.7942', ''],
  ['Park St → Harvard, step-free', '42.3564,-71.0624', '42.3734,-71.1189', '&stepFree=1'],
  ['Boston Common → Faneuil Hall (walk it?)', '42.3551,-71.0656', '42.3600,-71.0568', ''],
  ['Park St → Fenway Park', '42.3564,-71.0624', '42.3467,-71.0972', ''],
  ['Kenmore → Logan (Blue + SL)', '42.3489,-71.0950', '42.3656,-71.0096', ''],
];
for (const [name, from, to, extra] of cases) {
  const t = performance.now();
  const res = await fetch(`${base}/api/plan?from=${from}&to=${to}&time=${at}${extra}`);
  const body = await res.json();
  const ms = Math.round(performance.now() - t);
  if (!res.ok) { console.log(name, res.status, body); continue; }
  console.log(`\n${name}  (${ms} ms, ${body.options.length} options, live=${body.live}) ${body.messages.join(' ')}`);
  for (const o of body.options.slice(0, 4)) {
    const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    const legs = o.legs.map((l: any) => (l.transit ? `${l.routeLabel}[${l.source}]` : `walk${Math.round(l.durationS / 60)}`)).join(' > ');
    console.log(`  ${clock(o.start)}→${clock(o.end)}${o.alsoAt.length ? " (also " + o.alsoAt.map(clock).join(",") + ")" : ""} ${Math.round(o.durationS / 60)}m  ${legs}  transfers=${o.transfers} risk=${o.risk.level}${o.risk.transfers[0] ? " [" + Math.round(o.risk.transfers[0].spareS) + "s spare, next " + o.risk.transfers[0].nextGapS + "s]" : ""} fare=${o.fare?.cents ?? '?'}${o.stepFree ? ' step-free' : ''}`);
  }
}
const g = await (await fetch(`${base}/api/geocode?q=${encodeURIComponent('fenway park')}&near=42.35,-71.06`)).json();
console.log('\ngeocode "fenway park":', g.placesAvailable, g.results.slice(0, 5).map((r: any) => `${r.kind}:${r.name} (${r.detail})`).join(' | '));
