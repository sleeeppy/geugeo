import { afterEach, describe, expect, it } from 'vitest';
import { userDbKey } from '../src/security/crypto.js';
import { openEncrypted } from '../src/store/openDb.js';
import { userDbPath } from '../src/store/userStore.js';
import { channel, cleanup, fixtureStore, message } from './helpers.js';

const opened: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const item of opened.splice(0)) item.close();
});

describe('userStore', () => {
  it('refuses to open a user database with the wrong key', () => {
    const fx = fixtureStore();
    opened.push(fx);
    fx.users.get('100000000000000001').upsertChannel(channel({ id: '10' }));
    fx.users.closeAll();
    const wrong = userDbKey(Buffer.alloc(32, 7), '100000000000000001');
    expect(() => openEncrypted(userDbPath(fx.dir, '100000000000000001'), wrong).prepare('SELECT * FROM channels').all()).toThrow();
  });

  it('updates the FTS index when a message is edited', () => {
    const fx = fixtureStore();
    opened.push(fx);
    const store = fx.users.get('100000000000000001');
    store.upsertChannel(channel({ id: '10' }));
    store.upsertMessages([message({ id: '1', content: 'alpha 단어', searchText: 'alpha 단어' })]);
    store.upsertMessages([message({ id: '1', content: 'beta 단어', searchText: 'beta 단어' })]);
    const alpha = store.db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH '"alpha"'`).all();
    const beta = store.db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH '"beta"'`).all();
    expect(alpha).toHaveLength(0);
    expect(beta).toHaveLength(1);
  });

  it('removes a message from the FTS index when it is deleted', () => {
    const fx = fixtureStore();
    opened.push(fx);
    const store = fx.users.get('100000000000000001');
    store.upsertChannel(channel({ id: '10' }));
    store.upsertMessages([message({ id: '1', content: '삭제대상 문장', searchText: '삭제대상 문장' })]);
    store.deleteMessage('1');
    const rows = store.db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH '"삭제대상"'`).all();
    expect(rows).toHaveLength(0);
    expect(store.getMessage('1')).toBeNull();
  });

  it('stores one row when the same message arrives twice', () => {
    const fx = fixtureStore();
    opened.push(fx);
    const store = fx.users.get('100000000000000001');
    store.upsertChannel(channel({ id: '10' }));
    store.upsertMessages([message({ id: '1', content: '같은 메시지', searchText: '같은 메시지' })]);
    store.upsertMessages([message({ id: '1', content: '같은 메시지 수정', searchText: '같은 메시지 수정' })]);
    expect(store.countMessages()).toBe(1);
    expect(store.getMessage('1')?.content).toBe('같은 메시지 수정');
  });

  it('deletes saved messages and channels without removing the database', () => {
    const fx = fixtureStore();
    opened.push(fx);
    const store = fx.users.get('100000000000000001');
    store.upsertChannel(channel({ id: '10' }));
    store.upsertMessages([message({ id: '1', content: '지울 메시지', searchText: '지울 메시지' })]);
    expect(store.wipe()).toEqual({ messages: 1, channels: 1 });
    expect(store.countMessages()).toBe(0);
    expect(store.listChannels()).toHaveLength(0);
  });

  it('drops messages collected before per-DM opt-in', () => {
    const fx = fixtureStore();
    opened.push(fx);
    const userId = '100000000000000009';
    const db = openEncrypted(userDbPath(fx.dir, userId), userDbKey(fx.master, userId));
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE channels (
        id TEXT PRIMARY KEY, type INTEGER NOT NULL, recipient_id TEXT NOT NULL, recipient_name TEXT NOT NULL,
        last_message_id TEXT, newest_synced_id TEXT, oldest_synced_id TEXT,
        backfill_done INTEGER NOT NULL DEFAULT 0, message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '', search_text TEXT NOT NULL, ts INTEGER NOT NULL, edited_ts INTEGER,
        has_link INTEGER NOT NULL DEFAULT 0, has_image INTEGER NOT NULL DEFAULT 0, has_file INTEGER NOT NULL DEFAULT 0,
        has_youtube INTEGER NOT NULL DEFAULT 0, attachments TEXT
      );
      CREATE TABLE embeddings (message_id TEXT PRIMARY KEY, vec BLOB NOT NULL);
      CREATE TABLE backfill_seen (channel_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY (channel_id, message_id));
      INSERT INTO meta (key, value) VALUES ('schema_version', '1');
      INSERT INTO channels (id, type, recipient_id, recipient_name, message_count) VALUES ('10', 1, '2', '민수', 1);
      INSERT INTO messages (id, channel_id, author_id, author_name, content, search_text, ts) VALUES ('1', '10', '2', '민수', '비밀', '비밀', 1);
    `);
    db.close();
    const store = fx.users.get(userId);
    expect(store.listChannels()).toHaveLength(0);
    expect(store.countMessages()).toBe(0);
    expect(store.getChannel('10')).toBeNull();
  });
});

describe('registry', () => {
  it('stores and clears an encrypted token reference', () => {
    const fx = fixtureStore();
    opened.push(fx);
    fx.registry.upsert({ userId: '100000000000000001', username: 'me', tokenEnc: 'v1:abc', status: 'syncing' });
    expect(fx.registry.get('100000000000000001')?.tokenEnc).toBe('v1:abc');
    fx.registry.clearToken('100000000000000001');
    const user = fx.registry.get('100000000000000001');
    expect(user?.tokenEnc).toBeNull();
    expect(user?.status).toBe('token_invalid');
  });
});

void cleanup;
