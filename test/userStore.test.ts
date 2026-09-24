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
