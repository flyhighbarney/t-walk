// Opted-in commutes and the push address of the device that asked, in their
// own small SQLite file (data/push.sqlite), separate from the GTFS data.
// Nothing else about the rider is kept: no account, no location history.

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Commute } from '@twalk/core';

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface StoredCommute {
  id: string;
  commute: Commute;
  subscription: PushSubscriptionJson;
  /** What was last sent, so a notification goes out once, and again only on a real change. */
  lastLeave: { date: string; leaveAt: number; signature: string } | null;
  lastBackup: { date: string; signature: string } | null;
}

export class PushStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS commutes (
        id TEXT PRIMARY KEY,
        commute TEXT NOT NULL,
        subscription TEXT NOT NULL,
        last_leave TEXT,
        last_backup TEXT,
        created_at INTEGER NOT NULL
      );`);
  }

  add(commute: Commute, subscription: PushSubscriptionJson): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO commutes (id, commute, subscription, created_at) VALUES (?, ?, ?, ?)').run(id, JSON.stringify(commute), JSON.stringify(subscription), Date.now());
    return id;
  }

  update(id: string, commute: Commute): boolean {
    return Number(this.db.prepare('UPDATE commutes SET commute = ?, last_leave = NULL, last_backup = NULL WHERE id = ?').run(JSON.stringify(commute), id).changes) > 0;
  }

  remove(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM commutes WHERE id = ?').run(id).changes) > 0;
  }

  /** A device's push address stopped working: everything sent to it goes. */
  removeEndpoint(endpoint: string): void {
    for (const c of this.all()) if (c.subscription.endpoint === endpoint) this.remove(c.id);
  }

  get(id: string): StoredCommute | null {
    return this.all().find((c) => c.id === id) ?? null;
  }

  all(): StoredCommute[] {
    return (this.db.prepare('SELECT * FROM commutes').all() as { id: string; commute: string; subscription: string; last_leave: string | null; last_backup: string | null }[]).map((r) => ({
      id: r.id,
      commute: JSON.parse(r.commute) as Commute,
      subscription: JSON.parse(r.subscription) as PushSubscriptionJson,
      lastLeave: r.last_leave ? JSON.parse(r.last_leave) : null,
      lastBackup: r.last_backup ? JSON.parse(r.last_backup) : null,
    }));
  }

  markLeave(id: string, v: StoredCommute['lastLeave']): void {
    this.db.prepare('UPDATE commutes SET last_leave = ? WHERE id = ?').run(JSON.stringify(v), id);
  }

  markBackup(id: string, v: StoredCommute['lastBackup']): void {
    this.db.prepare('UPDATE commutes SET last_backup = ? WHERE id = ?').run(JSON.stringify(v), id);
  }

  close(): void {
    this.db.close();
  }
}
