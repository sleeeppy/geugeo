import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3-multiple-ciphers';
import { registryKey } from '../security/crypto.js';
import { openEncrypted } from './openDb.js';

export type UserStatus = 'syncing' | 'ready' | 'error' | 'token_invalid';

export interface SyncProgress {
  channelsDone: number;
  channelsTotal: number;
  messages: number;
}

export interface RegistryUser {
  userId: string;
  username: string;
  tokenEnc: string | null;
  status: UserStatus;
  progress: SyncProgress | null;
  lastSyncAt: number | null;
  lastError: string | null;
  createdAt: number;
}

interface UserRow {
  user_id: string;
  username: string;
  token_enc: string | null;
  status: UserStatus;
  progress_json: string | null;
  last_sync_at: number | null;
  last_error: string | null;
  created_at: number;
}

export class Registry {
  readonly db: Database.Database;

  constructor(dataDir: string, master: Buffer) {
    this.db = openEncrypted(join(dataDir, 'registry.db'), registryKey(master));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        token_enc TEXT,
        status TEXT NOT NULL,
        progress_json TEXT,
        last_sync_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  get(userId: string): RegistryUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  list(): RegistryUser[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[];
    return rows.map(mapUser);
  }

  upsert(input: { userId: string; username: string; tokenEnc: string | null; status: UserStatus }): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO users (user_id, username, token_enc, status, created_at)
         VALUES (@userId, @username, @tokenEnc, @status, @now)
         ON CONFLICT(user_id) DO UPDATE SET
           username = excluded.username,
           token_enc = excluded.token_enc,
           status = excluded.status,
           last_error = NULL`,
      )
      .run({ ...input, now });
  }

  setStatus(userId: string, status: UserStatus, lastError: string | null = null): void {
    this.db.prepare('UPDATE users SET status = ?, last_error = ? WHERE user_id = ?').run(status, lastError, userId);
  }

  setProgress(userId: string, progress: SyncProgress): void {
    this.db.prepare('UPDATE users SET progress_json = ? WHERE user_id = ?').run(JSON.stringify(progress), userId);
  }

  setLastSync(userId: string, at = Date.now()): void {
    this.db.prepare('UPDATE users SET last_sync_at = ? WHERE user_id = ?').run(at, userId);
  }

  clearToken(userId: string): void {
    this.db
      .prepare(`UPDATE users SET token_enc = NULL, status = 'token_invalid' WHERE user_id = ?`)
      .run(userId);
  }

  delete(userId: string): void {
    this.db.prepare('DELETE FROM users WHERE user_id = ?').run(userId);
  }
}

function mapUser(row: UserRow): RegistryUser {
  let progress: SyncProgress | null = null;
  if (row.progress_json) {
    const parsed = JSON.parse(row.progress_json) as SyncProgress;
    progress = parsed;
  }
  return {
    userId: row.user_id,
    username: row.username,
    tokenEnc: row.token_enc,
    status: row.status,
    progress,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export function removeUserDbFiles(dataDir: string, userId: string): void {
  assertUserId(userId);
  const base = join(dataDir, 'users', `${userId}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(base + suffix, { force: true });
  }
}

export function assertUserId(userId: string): void {
  if (!/^\d{5,22}$/.test(userId)) {
    throw new Error('사용자 ID 형식이 올바르지 않아요.');
  }
}
