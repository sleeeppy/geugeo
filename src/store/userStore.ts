import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3-multiple-ciphers';
import { userDbKey } from '../security/crypto.js';
import { openEncrypted } from './openDb.js';
import { SCHEMA_VERSION, USER_SCHEMA_SQL } from './schema.sql.js';
import { assertUserId } from './registry.js';

export interface AttachmentMeta {
  name: string;
  size: number;
  contentType: string | null;
}

export interface StoredMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
  searchText: string;
  ts: number;
  editedTs: number | null;
  hasLink: boolean;
  hasImage: boolean;
  hasFile: boolean;
  hasYoutube: boolean;
  attachments: AttachmentMeta[];
}

export interface StoredChannel {
  id: string;
  type: number;
  recipientId: string;
  recipientName: string;
  lastMessageId: string | null;
  newestSyncedId: string | null;
  oldestSyncedId: string | null;
  backfillDone: boolean;
  messageCount: number;
  tracked: boolean;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  search_text: string;
  ts: number;
  edited_ts: number | null;
  has_link: number;
  has_image: number;
  has_file: number;
  has_youtube: number;
  attachments: string | null;
}

interface ChannelRow {
  id: string;
  type: number;
  recipient_id: string;
  recipient_name: string;
  last_message_id: string | null;
  newest_synced_id: string | null;
  oldest_synced_id: string | null;
  backfill_done: number;
  message_count: number;
  tracked: number;
}

export class UserStore {
  readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.migrate();
  }

  private migrate(): void {
    const hasMeta = this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).get();
    const current = hasMeta
      ? (this.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined)
      : undefined;
    const version = current ? Number(current.value) : 0;
    if (version > SCHEMA_VERSION) {
      throw new Error('이 데이터 파일은 더 새 버전의 그거로 만들어졌어요.');
    }
    if (version === 1) {
      this.db.exec(`
        DROP TRIGGER IF EXISTS messages_ai;
        DROP TRIGGER IF EXISTS messages_ad;
        DROP TRIGGER IF EXISTS messages_au;
        DELETE FROM messages;
        DELETE FROM embeddings;
        DELETE FROM backfill_seen;
        DELETE FROM channels;
        DROP TABLE IF EXISTS messages_fts;
      `);
    }
    this.db.exec(USER_SCHEMA_SQL);
    const columns = this.db.prepare(`PRAGMA table_info(channels)`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'tracked')) {
      this.db.exec(`ALTER TABLE channels ADD COLUMN tracked INTEGER NOT NULL DEFAULT 0`);
    }
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(SCHEMA_VERSION));
  }

  upsertChannel(channel: StoredChannel): void {
    this.db
      .prepare(
        `INSERT INTO channels (
           id, type, recipient_id, recipient_name, last_message_id,
           newest_synced_id, oldest_synced_id, backfill_done, message_count, tracked
         ) VALUES (
           @id, @type, @recipientId, @recipientName, @lastMessageId,
           @newestSyncedId, @oldestSyncedId, @backfillDone, @messageCount, @tracked
         )
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           recipient_id = excluded.recipient_id,
           recipient_name = excluded.recipient_name,
           last_message_id = excluded.last_message_id,
           tracked = CASE WHEN excluded.tracked = 1 THEN 1 ELSE channels.tracked END`,
      )
      .run({
        ...channel,
        backfillDone: channel.backfillDone ? 1 : 0,
        tracked: channel.tracked ? 1 : 0,
      });
  }

  updateChannelCursor(input: {
    id: string;
    newestSyncedId?: string | null;
    oldestSyncedId?: string | null;
    backfillDone?: boolean;
    messageCount?: number;
    lastMessageId?: string | null;
  }): void {
    const current = this.getChannel(input.id);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE channels SET
           newest_synced_id = ?,
           oldest_synced_id = ?,
           backfill_done = ?,
           message_count = ?,
           last_message_id = ?
         WHERE id = ?`,
      )
      .run(
        input.newestSyncedId === undefined ? current.newestSyncedId : input.newestSyncedId,
        input.oldestSyncedId === undefined ? current.oldestSyncedId : input.oldestSyncedId,
        input.backfillDone === undefined ? (current.backfillDone ? 1 : 0) : input.backfillDone ? 1 : 0,
        input.messageCount === undefined ? current.messageCount : input.messageCount,
        input.lastMessageId === undefined ? current.lastMessageId : input.lastMessageId,
        input.id,
      );
  }

  getChannel(id: string): StoredChannel | null {
    const row = this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as ChannelRow | undefined;
    return row ? mapChannel(row) : null;
  }

  listChannels(): StoredChannel[] {
    const rows = this.db.prepare('SELECT * FROM channels').all() as ChannelRow[];
    return rows.map(mapChannel);
  }

  listTracked(): StoredChannel[] {
    return this.listChannels().filter((channel) => channel.tracked);
  }

  searchRecipients(prefix: string, limit = 25): Array<{ id: string; name: string }> {
    const escaped = prefix.replace(/[\\%_]/g, (char) => `\\${char}`);
    const rows = this.db
      .prepare(
        `SELECT id, recipient_name AS name FROM channels
         WHERE tracked = 1 AND recipient_name LIKE ? ESCAPE '\\'
         ORDER BY recipient_name
         LIMIT ?`,
      )
      .all(`${escaped}%`, limit) as Array<{ id: string; name: string }>;
    return rows;
  }

  upsertMessages(messages: StoredMessage[]): void {
    if (messages.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO messages (
         id, channel_id, author_id, author_name, content, search_text, ts, edited_ts,
         has_link, has_image, has_file, has_youtube, attachments
       ) VALUES (
         @id, @channelId, @authorId, @authorName, @content, @searchText, @ts, @editedTs,
         @hasLink, @hasImage, @hasFile, @hasYoutube, @attachments
       )
       ON CONFLICT(id) DO UPDATE SET
         channel_id = excluded.channel_id,
         author_id = excluded.author_id,
         author_name = excluded.author_name,
         content = excluded.content,
         search_text = excluded.search_text,
         ts = excluded.ts,
         edited_ts = excluded.edited_ts,
         has_link = excluded.has_link,
         has_image = excluded.has_image,
         has_file = excluded.has_file,
         has_youtube = excluded.has_youtube,
         attachments = excluded.attachments`,
    );
    const write = this.db.transaction((batch: StoredMessage[]) => {
      for (const message of batch) {
        stmt.run({
          ...message,
          hasLink: message.hasLink ? 1 : 0,
          hasImage: message.hasImage ? 1 : 0,
          hasFile: message.hasFile ? 1 : 0,
          hasYoutube: message.hasYoutube ? 1 : 0,
          attachments: JSON.stringify(message.attachments),
        });
      }
    });
    for (let index = 0; index < messages.length; index += 500) {
      write(messages.slice(index, index + 500));
    }
    const channels = new Set(messages.map((message) => message.channelId));
    const countStmt = this.db.prepare(
      'UPDATE channels SET message_count = (SELECT COUNT(*) FROM messages WHERE channel_id = ?) WHERE id = ?',
    );
    for (const channelId of channels) countStmt.run(channelId, channelId);
  }

  deleteMessage(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }

  getMessage(id: string): StoredMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
    return row ? mapMessage(row) : null;
  }

  countMessages(channelId?: string): number {
    if (channelId) {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ?').get(channelId) as {
        n: number;
      };
      return row.n;
    }
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    return row.n;
  }

  listMessagesForEmbedding(limit: number): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages m
         LEFT JOIN embeddings e ON e.message_id = m.id
         WHERE e.message_id IS NULL
         ORDER BY m.ts DESC
         LIMIT ?`,
      )
      .all(limit) as MessageRow[];
    return rows.map(mapMessage);
  }

  countEmbeddings(): { embedded: number; eligible: number } {
    const embedded = (
      this.db.prepare('SELECT COUNT(*) AS n FROM embeddings WHERE length(vec) = 1536').get() as { n: number }
    ).n;
    const eligible = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE length(trim(search_text)) >= 4`).get() as { n: number }
    ).n;
    return { embedded, eligible };
  }

  putEmbeddings(rows: Array<{ messageId: string; vec: Buffer }>): void {
    const stmt = this.db.prepare(
      `INSERT INTO embeddings (message_id, vec) VALUES (?, ?)
       ON CONFLICT(message_id) DO UPDATE SET vec = excluded.vec`,
    );
    const write = this.db.transaction((batch: Array<{ messageId: string; vec: Buffer }>) => {
      for (const row of batch) stmt.run(row.messageId, row.vec);
    });
    write(rows);
  }

  listEmbeddings(channelId?: string): Array<{ messageId: string; vec: Buffer }> {
    const rows = channelId
      ? (this.db
          .prepare(
            `SELECT e.message_id AS messageId, e.vec AS vec
             FROM embeddings e JOIN messages m ON m.id = e.message_id
             WHERE m.channel_id = ?`,
          )
          .all(channelId) as Array<{ messageId: string; vec: Buffer }>)
      : (this.db.prepare('SELECT message_id AS messageId, vec AS vec FROM embeddings').all() as Array<{
          messageId: string;
          vec: Buffer;
        }>);
    return rows;
  }

  messagesByIds(ids: string[]): StoredMessage[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM messages WHERE id IN (${placeholders})`).all(...ids) as MessageRow[];
    const byId = new Map(rows.map((row) => [row.id, mapMessage(row)]));
    return ids.flatMap((id) => {
      const message = byId.get(id);
      return message ? [message] : [];
    });
  }

  clearBackfillSeen(channelId: string): void {
    this.db.prepare('DELETE FROM backfill_seen WHERE channel_id = ?').run(channelId);
  }

  markBackfillSeen(channelId: string, messageIds: string[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO backfill_seen (channel_id, message_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
    );
    const write = this.db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(channelId, id);
    });
    write(messageIds);
  }

  deleteUnseenMessages(channelId: string): number {
    const result = this.db
      .prepare(
        `DELETE FROM messages
         WHERE channel_id = ?
           AND id NOT IN (SELECT message_id FROM backfill_seen WHERE channel_id = ?)`,
      )
      .run(channelId, channelId);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}

export class UserDirectory {
  private readonly openStores = new Map<string, UserStore>();

  constructor(
    private readonly dataDir: string,
    private readonly master: Buffer,
  ) {
    mkdirSync(join(dataDir, 'users'), { recursive: true });
  }

  get(userId: string): UserStore {
    assertUserId(userId);
    const existing = this.openStores.get(userId);
    if (existing) return existing;
    const db = openEncrypted(join(this.dataDir, 'users', `${userId}.db`), userDbKey(this.master, userId));
    const store = new UserStore(db);
    this.openStores.set(userId, store);
    return store;
  }

  hasFile(userId: string): boolean {
    assertUserId(userId);
    return this.openStores.has(userId) || existsSync(join(this.dataDir, 'users', `${userId}.db`));
  }

  close(userId: string): void {
    const store = this.openStores.get(userId);
    if (!store) return;
    store.close();
    this.openStores.delete(userId);
  }

  closeAll(): void {
    for (const store of this.openStores.values()) store.close();
    this.openStores.clear();
  }
}

function mapChannel(row: ChannelRow): StoredChannel {
  return {
    id: row.id,
    type: row.type,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name,
    lastMessageId: row.last_message_id,
    newestSyncedId: row.newest_synced_id,
    oldestSyncedId: row.oldest_synced_id,
    backfillDone: row.backfill_done === 1,
    messageCount: row.message_count,
    tracked: row.tracked === 1,
  };
}

function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    searchText: row.search_text,
    ts: row.ts,
    editedTs: row.edited_ts,
    hasLink: row.has_link === 1,
    hasImage: row.has_image === 1,
    hasFile: row.has_file === 1,
    hasYoutube: row.has_youtube === 1,
    attachments: row.attachments ? (JSON.parse(row.attachments) as AttachmentMeta[]) : [],
  };
}

export function userDbPath(dataDir: string, userId: string): string {
  assertUserId(userId);
  return join(dataDir, 'users', `${userId}.db`);
}
