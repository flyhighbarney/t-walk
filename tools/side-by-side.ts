// node tools/side-by-side.ts → http://127.0.0.1:8799: Now, Map, Trips and Saved at phone size, side by side (needs npm start).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const page = readFileSync(join(import.meta.dirname, 'side-by-side.html'));
createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page)).listen(8799, '127.0.0.1', () =>
  console.log('side-by-side preview on http://127.0.0.1:8799'),
);
