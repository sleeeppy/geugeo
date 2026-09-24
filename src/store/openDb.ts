import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

export function openEncrypted(file: string, key: Buffer): Database.Database {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`key = "x'${key.toString('hex')}'"`);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
