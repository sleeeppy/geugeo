import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { encryptSecret, tokenKey } from '../src/security/crypto.js';
import { TokenInvalidError, type ApiRawMessage } from '../src/discord/userApi.js';
import { Syncer } from '../src/sync/syncer.js';
import { fixtureStore } from './helpers.js';

const opened: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const item of opened.splice(0)) item.close();
});

function msg(id: string, content = `m${id}`): ApiRawMessage {
  return {
    id,
    type: 0,
    content,
    timestamp: '2024-01-01T00:00:00.000Z',
    author: { id: '2', username: 'minsu', global_name: '민수' },
  };
}

describe('syncer', () => {
  it('resumes a backfill from the oldest synced id', async () => {
    const fx = fixtureStore();
    opened.push(fx);
    const userId = '100000000000000021';
    fx.registry.upsert({
      userId,
      username: 'me',
      tokenEnc: encryptSecret(tokenKey(fx.master), 'tok', userId),
      status: 'syncing',
    });
    const all = ['300', '200', '100', '50', '40'].map((id) => msg(id));
    let calls = 0;
    const api = {
      async getChannels() {
        return [{ id: '10', type: 1, last_message_id: '300', recipients: [{ id: '2', username: 'minsu', global_name: '민수' }] }];
      },
      async getMessages(_token: string, _channelId: string, query: { before?: string; after?: string }) {
        calls += 1;
        if (calls === 2) throw new Error('끊김');
        const before = query.before ? BigInt(query.before) : null;
        const page = all.filter((message) => (before == null ? true : BigInt(message.id) < before)).slice(0, 3);
        return [page[1], page[0], page[2]].filter((item): item is ApiRawMessage => item != null);
      },
    };
    const first = new Syncer({ registry: fx.registry, users: fx.users, api, masterKey: fx.master, log: createLogger('error') });
    expect(await first.beginCollect(userId, '10')).toBe('민수');
    await first.collectChannel(userId, '10');
    expect(fx.registry.get(userId)?.status).toBe('error');
    const channel = fx.users.get(userId).getChannel('10');
    expect(channel?.oldestSyncedId).toBe('100');
    expect(channel?.backfillDone).toBe(false);

    calls = 10;
    const second = new Syncer({ registry: fx.registry, users: fx.users, api, masterKey: fx.master, log: createLogger('error') });
    await second.backfillUser(userId);
    const ids = fx.users
      .get(userId)
      .db.prepare('SELECT id FROM messages ORDER BY CAST(id AS INTEGER)')
      .all() as Array<{ id: string }>;
    expect(ids.map((row) => row.id)).toEqual(['40', '50', '100', '200', '300']);
    expect(fx.users.get(userId).getChannel('10')?.backfillDone).toBe(true);
    expect(fx.registry.get(userId)?.status).toBe('ready');
  });

  it('stores an incremental page regardless of response order', async () => {
    const fx = fixtureStore();
    opened.push(fx);
    const userId = '100000000000000022';
    fx.registry.upsert({
      userId,
      username: 'me',
      tokenEnc: encryptSecret(tokenKey(fx.master), 'tok', userId),
      status: 'ready',
    });
    const store = fx.users.get(userId);
    store.upsertChannel({
      id: '10',
      type: 1,
      recipientId: '2',
      recipientName: '민수',
      lastMessageId: '3',
      newestSyncedId: '1',
      oldestSyncedId: '1',
      backfillDone: true,
      messageCount: 1,
      tracked: true,
    });
    store.upsertMessages([
      {
        id: '1',
        channelId: '10',
        authorId: '2',
        authorName: '민수',
        content: 'old',
        searchText: 'old',
        ts: 1,
        editedTs: null,
        hasLink: false,
        hasImage: false,
        hasFile: false,
        hasYoutube: false,
        attachments: [],
      },
    ]);
    const api = {
      async getChannels() {
        return [{ id: '10', type: 1, last_message_id: '3', recipients: [{ id: '2', username: 'minsu', global_name: '민수' }] }];
      },
      async getMessages() {
        return [msg('3'), msg('1'), msg('2')];
      },
    };
    const syncer = new Syncer({ registry: fx.registry, users: fx.users, api, masterKey: fx.master, log: createLogger('error') });
    await syncer.incrementalChannel(userId, '10');
    const ids = (store.db.prepare('SELECT id FROM messages').all() as Array<{ id: string }>).map((row) => row.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
    expect(store.getChannel('10')?.newestSyncedId).toBe('3');
  });

  it('discards the token when Discord returns 401', async () => {
    const fx = fixtureStore();
    opened.push(fx);
    const userId = '100000000000000023';
    fx.registry.upsert({
      userId,
      username: 'me',
      tokenEnc: encryptSecret(tokenKey(fx.master), 'tok', userId),
      status: 'syncing',
    });
    const api = {
      async getChannels(): Promise<never> {
        throw new TokenInvalidError();
      },
      async getMessages(): Promise<ApiRawMessage[]> {
        return [];
      },
    };
    const syncer = new Syncer({ registry: fx.registry, users: fx.users, api, masterKey: fx.master, log: createLogger('error') });
    await expect(syncer.beginCollect(userId, '10')).rejects.toBeInstanceOf(TokenInvalidError);
    const user = fx.registry.get(userId);
    expect(user?.tokenEnc).toBeNull();
    expect(user?.status).toBe('token_invalid');
  });

  it('collects only the DM where collection was requested', async () => {
    const fx = fixtureStore();
    opened.push(fx);
    const userId = '100000000000000024';
    fx.registry.upsert({
      userId,
      username: 'me',
      tokenEnc: encryptSecret(tokenKey(fx.master), 'tok', userId),
      status: 'ready',
    });
    const seen: string[] = [];
    const api = {
      async getChannels() {
        return [
          { id: '10', type: 1, last_message_id: '2', recipients: [{ id: '2', username: 'minsu', global_name: '민수' }] },
          { id: '11', type: 1, last_message_id: '9', recipients: [{ id: '3', username: 'other', global_name: '다른사람' }] },
        ];
      },
      async getMessages(_token: string, channelId: string, query: { before?: string }) {
        seen.push(channelId);
        if (query.before) return [];
        return channelId === '10' ? [msg('2'), msg('1')] : [msg('9')];
      },
    };
    const syncer = new Syncer({ registry: fx.registry, users: fx.users, api, masterKey: fx.master, log: createLogger('error') });
    expect(await syncer.beginCollect(userId, '10')).toBe('민수');
    await syncer.collectChannel(userId, '10');
    const store = fx.users.get(userId);
    expect(store.listChannels().map((channel) => channel.id)).toEqual(['10']);
    expect(store.listTracked()).toHaveLength(1);
    expect(seen.every((id) => id === '10')).toBe(true);
    expect(store.countMessages()).toBe(2);
    expect(fx.registry.get(userId)?.status).toBe('ready');
  });
});
