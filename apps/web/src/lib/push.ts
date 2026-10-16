// Turning leave-now notifications on and off for a commute. The commute is
// sent to the server only when notifications are switched on, and deleted
// there when they're switched off.

import type { Commute } from '@twalk/core';
import { apiUrl, getJson } from './api.ts';

export type PushSupport = 'ok' | 'unsupported' | 'ios-install' | 'denied';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iPhone and iPad only offer web push to an app on the Home Screen (iOS 16.4+).
    return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: `HTTP ${res.status}` }))).error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Ask for permission, subscribe this device, and register the commute. Returns the server's id for it. */
export async function enablePush(commute: Commute): Promise<string> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. You can allow them in your browser settings.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await getJson<{ publicKey: string }>('/api/push/key');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const { id } = await send<{ id: string }>('POST', '/api/push/commutes', { commute: { ...commute, notify: true }, subscription: sub.toJSON() });
  return id;
}

export const updatePush = (serverId: string, commute: Commute) => send('PUT', `/api/push/commutes/${encodeURIComponent(serverId)}`, { commute: { ...commute, notify: true } });
export const disablePush = (serverId: string) => send('DELETE', `/api/push/commutes/${encodeURIComponent(serverId)}`);
export const testPush = (serverId: string) => send<{ result: string }>('POST', `/api/push/commutes/${encodeURIComponent(serverId)}/test`);
