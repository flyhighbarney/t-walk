// npm run push:keys — creates the VAPID key pair web push needs and adds it to .env
// (git-ignored). Run once per server; changing keys invalidates existing subscriptions.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
const envPath = join(import.meta.dirname, '..', '.env');
const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
if (/^VAPID_PUBLIC_KEY=.+/m.test(env)) {
  console.log('.env already has VAPID keys; leaving them alone.');
} else {
  const k = webpush.generateVAPIDKeys();
  writeFileSync(envPath, `${env}${env && !env.endsWith('\n') ? '\n' : ''}\n# Web push (npm run push:keys)\nVAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\n`);
  console.log('Added VAPID keys to .env.');
}
